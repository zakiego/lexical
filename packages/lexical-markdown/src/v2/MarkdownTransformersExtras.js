/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {BlockTransformer} from './MarkdownPlugin';
import type {ElementNode, LexicalNode} from 'lexical';

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
