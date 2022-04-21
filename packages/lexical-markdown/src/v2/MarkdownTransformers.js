/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {BlockImportFn, BlockTransformer} from './MarkdownPlugin';
import type {ListNode} from '@lexical/list';
import type {HeadingTagType} from '@lexical/rich-text';
import type {ElementNode, LexicalNode} from 'lexical';

import {$createCodeNode, $isCodeNode} from '@lexical/code';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
} from '@lexical/list';
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
} from '@lexical/react/LexicalHorizontalRuleNode';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from '@lexical/rich-text';

const replaceWithBlock = (
  createNode: (match: Array<string>) => ElementNode,
): BlockImportFn => {
  return (parentNode, children, match) => {
    const node = createNode(match);
    node.append(...children);
    parentNode.replace(node);
    node.select(0, 0);
  };
};

// Amount of spaces that define indentation level
// TODO: should be an option
const LIST_INDENT_SIZE = 4;

const listReplace = (listTag: 'ul' | 'ol'): BlockImportFn => {
  return (parentNode, children, match) => {
    const previousNode = parentNode.getPreviousSibling();
    const listItem = $createListItemNode();
    if ($isListNode(previousNode) && previousNode.getTag() === listTag) {
      previousNode.append(listItem);
      parentNode.remove();
    } else {
      const list = $createListNode(
        listTag,
        listTag === 'ol' ? Number(match[2]) : undefined,
      );
      list.append(listItem);
      parentNode.replace(list);
    }
    listItem.append(...children);
    listItem.select(0, 0);
    const indent = Math.floor(match[1].length / LIST_INDENT_SIZE);
    if (indent) {
      listItem.setIndent(indent);
    }
  };
};

const listExport = (
  listNode: ListNode,
  exportChildren: (node: ElementNode) => string,
  depth: number,
): string => {
  const output = [];
  const children = listNode.getChildren();
  let index = 0;
  for (const listItemNode of children) {
    if ($isListItemNode(listItemNode)) {
      if (listItemNode.getChildrenSize() === 1) {
        const firstChild = listItemNode.getFirstChild();
        if ($isListNode(firstChild)) {
          output.push(listExport(firstChild, exportChildren, depth + 1));
          continue;
        }
      }
      const indent = ' '.repeat(depth * LIST_INDENT_SIZE);
      const prefix =
        listNode.getTag() === 'ul' ? '- ' : `${listNode.getStart() + index}. `;
      output.push(indent + prefix + exportChildren(listItemNode));
      index++;
    }
  }

  return output.join('\n');
};

export const HEADING: BlockTransformer = [
  /^(#{1,6})\s/,
  replaceWithBlock((match) => {
    // $FlowFixMe[incompatible-cast]
    const tag = ('h' + match[1].length: HeadingTagType);
    return $createHeadingNode(tag);
  }),
  (node: LexicalNode, exportChildren: (node: ElementNode) => string) => {
    if (!$isHeadingNode(node)) {
      return null;
    }
    const level = Number(node.getTag().slice(1));
    return '#'.repeat(level) + ' ' + exportChildren(node);
  },
];

export const QUOTE: BlockTransformer = [
  /^>\s/,
  replaceWithBlock(() => $createQuoteNode()),
  (node: LexicalNode, exportChildren: (node: ElementNode) => string) => {
    return $isQuoteNode(node) ? '> ' + exportChildren(node) : null;
  },
];

export const CODE: BlockTransformer = [
  /^```(\w{1,10})?\s/,
  replaceWithBlock((match) => {
    return $createCodeNode(match ? match[1] : undefined);
  }),
  (node: LexicalNode) => {
    if (!$isCodeNode(node)) {
      return null;
    }
    const textContent = node.getTextContent();
    return (
      '```' +
      (node.getLanguage() || '') +
      (textContent ? '\n' + textContent : '') +
      '\n' +
      '```'
    );
  },
];

export const UNORDERED_LIST: BlockTransformer = [
  /^(\s*)[-*+]\s/,
  listReplace('ul'),
  (node: LexicalNode, exportChildren: (node: ElementNode) => string) => {
    return $isListNode(node) ? listExport(node, exportChildren, 0) : null;
  },
];

export const ORDERED_LIST: BlockTransformer = [
  /^(\s*)(\d{1,}).\s/,
  listReplace('ol'),
  (node: LexicalNode, exportChildren: (node: ElementNode) => string) => {
    return $isListNode(node) ? listExport(node, exportChildren, 0) : null;
  },
];

// Note that space for HR is optional: it's still checked while typing
// but not required for importing

// TODO: this transformer should be created/passed from react-aware package,
// since <hr> is a decorator node
export const HR: BlockTransformer = [
  /^(---|\*\*\*|___)\s?$/,
  (parentNode) => {
    const line = $createHorizontalRuleNode();
    parentNode.insertBefore(line);
    parentNode.select(0, 0);
  },
  (node: LexicalNode) => {
    return $isHorizontalRuleNode(node) ? '***' : null;
  },
];

export const BLOCK_TRANSFORMERS: Array<BlockTransformer> = [
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  HR,
];

// Order of text transformers matters:
//
// - code should go first as it prevents any transformations inside
// - then longer tags match (e.g. ** or __ should go before * or _)
export const TEXT_TRANSFORMERS = [
  {format: ['code'], tag: '`'},
  {format: ['bold', 'italic'], tag: '***'},
  {format: ['bold', 'italic'], tag: '___'},
  {format: ['bold'], tag: '**'},
  {format: ['bold'], tag: '__'},
  {format: ['strikethrough'], tag: '~~'},
  {format: ['italic'], tag: '*'},
  {format: ['italic'], tag: '_'},
];
