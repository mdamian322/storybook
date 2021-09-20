import path from 'path';
import fs from 'fs-extra';
import glob from 'globby';

import { autoTitleFromSpecifier, sortStories, Path, StoryIndex } from '@storybook/store';
import { NormalizedStoriesSpecifier } from '@storybook/core-common';
import { logger } from '@storybook/node-logger';
import { readCsfOrMdx, getStorySortParameter } from '@storybook/csf-tools';

function sortExtractedStories(
  stories: StoryIndex['stories'],
  storySortParameter: any,
  fileNameOrder: string[]
) {
  const sortableStories = Object.entries(stories).map(([id, story]) => [
    id,
    { id, kind: story.title, story: story.name, ...story },
    { fileName: story.importPath },
  ]);
  sortStories(sortableStories, storySortParameter, fileNameOrder);
  return sortableStories.reduce((acc, item) => {
    const storyId = item[0] as string;
    acc[storyId] = stories[storyId];
    return acc;
  }, {} as StoryIndex['stories']);
}

export class StoryIndexGenerator {
  // An internal cache mapping specifiers to a set of path=><set of stories>
  // Later, we'll combine each of these subsets together to form the full index
  private storyIndexEntries: Map<
    NormalizedStoriesSpecifier,
    Record<Path, StoryIndex['stories'] | false>
  >;

  constructor(
    public readonly specifiers: NormalizedStoriesSpecifier[],
    public readonly configDir: Path
  ) {
    this.storyIndexEntries = new Map();
  }

  async initialize() {
    // Find all matching paths for each specifier
    await Promise.all(
      this.specifiers.map(async (specifier) => {
        const pathToSubIndex = {} as Record<Path, StoryIndex['stories'] | false>;

        const files = await glob(path.join(this.configDir, specifier.glob));
        files.forEach((fileName: Path) => {
          pathToSubIndex[fileName] = false;
        });

        this.storyIndexEntries.set(specifier, pathToSubIndex);
      })
    );

    // Extract stories for each file
    await this.ensureExtracted();
  }

  async ensureExtracted() {
    await Promise.all(
      this.specifiers.map(async (specifier) => {
        const entry = this.storyIndexEntries.get(specifier);
        await Promise.all(
          Object.keys(entry).map(async (fileName) => {
            if (!entry[fileName]) await this.extractStories(specifier, fileName);
          })
        );
      })
    );
  }

  async extractStories(specifier: NormalizedStoriesSpecifier, absolutePath: Path) {
    const ext = path.extname(absolutePath);
    const relativePath = path.relative(this.configDir, absolutePath);
    if (!['.js', '.jsx', '.ts', '.tsx', '.mdx'].includes(ext)) {
      logger.info(`Skipping ${ext} file ${relativePath}`);
      return;
    }
    try {
      const entry = this.storyIndexEntries.get(specifier);
      const fileStories = {} as StoryIndex['stories'];

      const importPath = relativePath[0] === '.' ? relativePath : `./${relativePath}`;
      const defaultTitle = autoTitleFromSpecifier(importPath, specifier);
      const csf = (await readCsfOrMdx(absolutePath, { defaultTitle })).parse();
      csf.stories.forEach(({ id, name }) => {
        fileStories[id] = {
          title: csf.meta.title,
          name,
          importPath,
        };
      });

      entry[absolutePath] = fileStories;
    } catch (err) {
      logger.warn(`🚨 Extraction error on ${relativePath}: ${err}`);
      logger.warn(`🚨 ${err.stack}`);
      throw err;
    }
  }

  async getIndex() {
    // Extract any entries that are currently missing
    await this.ensureExtracted();

    const stories: StoryIndex['stories'] = {};

    // Check each entry and compose into stories, extracting if needed
    this.specifiers.map(async (specifier) => {
      Object.values(this.storyIndexEntries.get(specifier)).map((subStories) =>
        Object.assign(stories, subStories)
      );
    });

    const storySortParameter = await this.getStorySortParameter();
    const sorted = sortExtractedStories(stories, storySortParameter, this.storyFileNames());

    return {
      v: 3,
      stories: sorted,
    };
  }

  async getStorySortParameter() {
    const previewFile = ['js', 'jsx', 'ts', 'tsx']
      .map((ext) => path.join(this.configDir, `preview.${ext}`))
      .find((fname) => fs.existsSync(fname));
    let storySortParameter;
    if (previewFile) {
      const previewCode = (await fs.readFile(previewFile, 'utf-8')).toString();
      storySortParameter = await getStorySortParameter(previewCode);
    }

    return storySortParameter;
  }

  // Get the story file names in "imported order"
  storyFileNames() {
    return Array.from(this.storyIndexEntries.values()).flatMap((r) => Object.keys(r));
  }
}
