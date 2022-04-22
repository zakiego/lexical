/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {CodeHighlightNode} from './CodeHighlightNode';
import type {LexicalNode} from 'lexical';

export function getFirstCodeHighlightNodeOfLine(
  anchor: LexicalNode,
): ?CodeHighlightNode {
  // $FlowFixMe[incompatible-cast]
  return anchor.getParentOrThrow().getFirstChild();
}

export function getLastCodeHighlightNodeOfLine(
  anchor: LexicalNode,
): ?CodeHighlightNode {
  // $FlowFixMe[incompatible-cast]
  return (anchor.getParentOrThrow().getLastChild(): CodeHighlightNode | null);
}
