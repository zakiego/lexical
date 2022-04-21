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
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
} from 'lexical';

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
// TODO: get rid of isImport flag
export const HR: BlockTransformer = [
  /^(---|\*\*\*|___)\s?$/,
  (parentNode, _1, _2, isImport) => {
    const line = $createHorizontalRuleNode();
    if (isImport) {
      parentNode.replace(line);
    } else {
      parentNode.insertBefore(line);
      parentNode.select(0, 0);
    }
  },
  (node: LexicalNode) => {
    return $isHorizontalRuleNode(node) ? '***' : null;
  },
];

const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/;
export const TABLE: BlockTransformer = [
  TABLE_ROW_REG_EXP,
  (parentNode, _1, match) => {
    const matchCells = mapToTableCells(match[0]);
    if (matchCells == null) {
      return;
    }

    const rows = [matchCells];
    let sibling = parentNode.getPreviousSibling();
    let maxCells = matchCells.length;
    while (sibling) {
      if (!$isParagraphNode(sibling)) {
        break;
      }

      if (sibling.getChildrenSize() !== 1) {
        break;
      }

      const firstChild = sibling.getFirstChild();
      if (!$isTextNode(firstChild)) {
        break;
      }

      const cells = mapToTableCells(firstChild.getTextContent());
      if (cells == null) {
        break;
      }

      maxCells = Math.max(maxCells, cells.length);
      rows.unshift(cells);
      const previousSibling = sibling.getPreviousSibling();
      sibling.remove();
      sibling = previousSibling;
    }

    const table = $createTableNode();
    for (const cells of rows) {
      const tableRow = $createTableRowNode();
      table.append(tableRow);
      for (let i = 0; i < maxCells; i++) {
        tableRow.append(i < cells.length ? cells[i] : createTableCell());
      }
    }

    parentNode.replace(table);
    table.selectEnd();
  },
  (node: LexicalNode, exportChildren: (node: ElementNode) => string) => {
    if (!$isTableNode(node)) {
      return null;
    }

    const output = [];
    for (const row of node.getChildren()) {
      const rowOutput = [];

      if ($isTableRowNode(row)) {
        for (const cell of row.getChildren()) {
          // It's TableCellNode (hence ElementNode) so it's just to make flow happy
          if ($isElementNode(cell)) {
            rowOutput.push(exportChildren(cell));
          }
        }
      }

      output.push(`|${rowOutput.join('|')}|`);
    }

    return output.join('\n');
  },
];

const createTableCell = (textContent: ?string): TableCellNode => {
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  const paragraph = $createParagraphNode();
  if (textContent != null) {
    paragraph.append($createTextNode(textContent));
  }
  cell.append(paragraph);
  return cell;
};

const mapToTableCells = (textContent: string): Array<TableCellNode> | null => {
  // TODO:
  // For now plain text, single node. Can be expanded to more complex content
  // including formatted text
  const match = textContent.match(TABLE_ROW_REG_EXP);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].split('|').map((text) => createTableCell(text));
};

export const BLOCK_TRANSFORMERS: Array<BlockTransformer> = [
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  HR,
  TABLE,
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
