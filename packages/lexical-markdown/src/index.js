/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {DecoratorNode, LexicalEditor} from 'lexical';

import {registerMarkdownPlugin} from './v2/MarkdownPlugin';
import {BLOCK_TRANSFORMERS, TEXT_TRANSFORMERS} from './v2/MarkdownTransformers';

export function registerMarkdownShortcuts<T>(
  editor: LexicalEditor,
  createHorizontalRuleNode: () => DecoratorNode<T>,
): () => void {
  return registerMarkdownPlugin(editor, BLOCK_TRANSFORMERS, TEXT_TRANSFORMERS);
}

export {BLOCK_TRANSFORMERS, TEXT_TRANSFORMERS};
export {createMarkdownExporter} from './v2/MarkdownExport';
export {createMarkdownImporter} from './v2/MarkdownImport';
export {registerMarkdownPlugin} from './v2/MarkdownPlugin';
