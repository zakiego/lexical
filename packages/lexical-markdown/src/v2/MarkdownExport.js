/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {BlockTransformer, TextTransformer} from './MarkdownPlugin';
import type {ElementNode, LexicalNode, TextFormatType, TextNode} from 'lexical';

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
      const result = exportTopLevelElementOrDecorator(
        child,
        blockTransformers,
        textTransformersIndex,
      );
      if (result != null) {
        output.push(result);
      }
    }

    return output.join('\n');
  };
}

function exportTopLevelElementOrDecorator(
  node: LexicalNode,
  blockTransformers: Array<BlockTransformer>,
  textTransformersIndex: TextTransformersIndex,
): string | null {
  for (const transformer of blockTransformers) {
    const result = transformer[2](node, (_node) =>
      exportChildren(_node, textTransformersIndex),
    );
    if (result != null) {
      return result;
    }
  }

  return $isElementNode(node)
    ? exportChildren(node, textTransformersIndex)
    : null;
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
        exportTextNode(
          child,
          child.getTextContent(),
          node,
          textTransformersIndex,
        ),
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
          exportTextNode(firstChild, linkContent, child, textTransformersIndex),
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
  parentNode: ElementNode,
  textTransformers: TextTransformersIndex,
): string {
  let output = textContent;
  const applied = new Set();
  for (const [format, tag] of textTransformers) {
    if (hasFormat(node, format) && !applied.has(format)) {
      // Multiple tags might be used for the same format (*, _)
      applied.add(format);

      // Prevent adding opening tag is already opened by the previous sibling
      const previousNode = getTextSibling(node, true);
      if (!hasFormat(previousNode, format)) {
        output = tag + output;
      }

      // Prevent adding closing tag if next sibling will do it
      const nextNode = getTextSibling(node, false);
      if (!hasFormat(nextNode, format)) {
        output += tag;
      }
    }
  }
  return output;
}

// Get next or previous text sibling a text node, including cases
// when it's a child of inline element (e.g. link)
function getTextSibling(node: TextNode, backward: boolean): TextNode | null {
  let sibling = backward ? node.getPreviousSibling() : node.getNextSibling();

  if (!sibling) {
    const parent = node.getParentOrThrow();
    if (parent.isInline()) {
      sibling = backward
        ? parent.getPreviousSibling()
        : parent.getNextSibling();
    }
  }

  while (sibling) {
    if ($isElementNode(sibling)) {
      if (!sibling.isInline()) {
        break;
      }
      const descendant = backward
        ? sibling.getLastDescendant()
        : sibling.getFirstDescendant();

      if ($isTextNode(descendant)) {
        return descendant;
      } else {
        sibling = backward
          ? sibling.getPreviousSibling()
          : sibling.getNextSibling();
      }
    }

    if ($isTextNode(sibling)) {
      return sibling;
    }
  }

  return null;
}

function hasFormat(node: LexicalNode | null, format: TextFormatType): boolean {
  return $isTextNode(node) && node.hasFormat(format);
}

function createTextTransformersIndex(
  textTransformers: Array<TextTransformer>,
): TextTransformersIndex {
  const index = [];
  for (const transformer of textTransformers) {
    // Skip combination of formats (e.g. *** for bold/italic) and
    // use individual tags instead
    if (transformer.format.length === 1) {
      index.push([transformer.format[0], transformer.tag]);
    }
  }
  return index;
}
