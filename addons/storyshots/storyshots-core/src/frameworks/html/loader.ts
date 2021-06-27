import { AugmentedGlobal } from '@storybook/core-client';
import _root from 'window-or-global';
import { StoryshotsOptions } from '../../api/StoryshotsOptions';
import configure from '../configure';
import { Loader } from '../Loader';

const root = _root as AugmentedGlobal;

function test(options: StoryshotsOptions): boolean {
  return options.framework === 'html';
}

function load(options: StoryshotsOptions) {
  root.STORYBOOK_ENV = 'html';

  const storybook = jest.requireActual('@storybook/html');

  configure({ ...options, storybook });

  return {
    framework: 'html' as const,
    renderTree: jest.requireActual('./renderTree').default,
    renderShallowTree: () => {
      throw new Error('Shallow renderer is not supported for HTML');
    },
    storybook,
  };
}

const htmLoader: Loader = {
  load,
  test,
};

export default htmLoader;
