/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {BlockTransformer, TextTransformer} from './MarkdownPlugin';
import type {ElementNode, TextFormatType, TextNode} from 'lexical';

import {$isLinkNode} from '@lexical/link';
import {$getRoot, $isElementNode, $isLineBreakNode, $isTextNode} from 'lexical';

type TextTransformersIndex = Array<[TextFormatType, string]>;

export function createMarkdownExporter(
  blockTransformers: Array<BlockTransformer>,
  textTransformers: Array<TextTransformer>,
): () => string {
  const textTransformersIndex = createTextTransformersIndex(textTransformers);
  return () => {
    const output = [];
    const children = $getRoot().getChildren();

    for (const child of children) {
      if ($isElementNode(child)) {
        output.push(
          exportElement(child, blockTransformers, textTransformersIndex),
        );
      }
    }

    return output.join('\n');
  };
}

function exportElement(
  node: ElementNode,
  blockTransformers: Array<BlockTransformer>,
  textTransformersIndex: TextTransformersIndex,
): string {
  for (const transformer of blockTransformers) {
    const result = transformer[2](node, (_node) =>
      exportChildren(_node, textTransformersIndex),
    );
    if (result != null) {
      return result;
    }
  }
  return exportChildren(node, textTransformersIndex);
}

function exportChildren(
  node: ElementNode,
  textTransformersIndex: TextTransformersIndex,
): string {
  const output = [];
  const children = node.getChildren();
  for (const child of children) {
    if ($isLineBreakNode(child)) {
      output.push('\n');
    } else if ($isTextNode(child)) {
      output.push(
        exportTextNode(child, child.getTextContent(), textTransformersIndex),
      );
    } else if ($isLinkNode(child)) {
      const linkContent = `[${child.getTextContent()}](${child.getURL()})`;
      const firstChild = child.getFirstChild();
      // Add text styles only if link has single text node inside. If it's more
      // then one we either ignore it and have single <a> to cover whole link,
      // or process them, but then have link cut into multiple <a>.
      // For now chosing the first option.
      if (child.getChildrenSize() === 1 && $isTextNode(firstChild)) {
        output.push(
          exportTextNode(firstChild, linkContent, textTransformersIndex),
        );
      } else {
        output.push(linkContent);
      }
    } else if ($isElementNode(child)) {
      output.push(exportChildren(child, textTransformersIndex));
    }
  }

  return output.join('');
}

function exportTextNode(
  node: TextNode,
  textContent: string,
  textTransformers: TextTransformersIndex,
): string {
  let output = textContent;
  const applied = new Set();
  for (const [format, tag] of textTransformers) {
    if (node.hasFormat(format) && !applied.has(format)) {
      applied.add(format);
      output = tag + output + tag;
    }
  }
  return output;
}

function createTextTransformersIndex(
  textTransformers: Array<TextTransformer>,
): TextTransformersIndex {
  const index = [];
  for (const transformer of textTransformers) {
    if (transformer.format.length === 1) {
      index.push([transformer.format[0], transformer.tag]);
    }
  }
  return index;
}
