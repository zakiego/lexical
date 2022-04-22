/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  ParagraphNode,
  RangeSelection,
} from 'lexical';

import {addClassNamesToElement} from '@lexical/utils';
import {$createLineBreakNode, $createParagraphNode, ElementNode} from 'lexical';

import {$createCodeHighlightNode, CodeHighlightNode} from './CodeHighlightNode';
import {getFirstCodeHighlightNodeOfLine} from './utils';

const LANGUAGE_DATA_ATTRIBUTE = 'data-highlight-language';

export class CodeNode extends ElementNode {
  __language: string | void;

  static getType(): string {
    return 'code';
  }

  static clone(node: CodeNode): CodeNode {
    return new CodeNode(node.__language, node.__key);
  }

  constructor(language?: string, key?: NodeKey): void {
    super(key);
    this.__language = language;
  }

  // View
  createDOM<EditorContext>(config: EditorConfig<EditorContext>): HTMLElement {
    const element = document.createElement('code');
    addClassNamesToElement(element, config.theme.code);
    element.setAttribute('spellcheck', 'false');
    const language = this.getLanguage();
    if (language) {
      element.setAttribute(LANGUAGE_DATA_ATTRIBUTE, language);
    }
    return element;
  }

  updateDOM(prevNode: CodeNode, dom: HTMLElement): boolean {
    const language = this.__language;
    const prevLanguage = prevNode.__language;

    if (language) {
      if (language !== prevLanguage) {
        dom.setAttribute(LANGUAGE_DATA_ATTRIBUTE, language);
      }
    } else if (prevLanguage) {
      dom.removeAttribute(LANGUAGE_DATA_ATTRIBUTE);
    }
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (node: Node) => ({
        conversion: convertDivElement,
        priority: 1,
      }),
      pre: (node: Node) => ({
        conversion: convertPreElement,
        priority: 0,
      }),
      table: (node: Node) => {
        // $FlowFixMe[incompatible-type] domNode is a <table> since we matched it by nodeName
        const table: HTMLTableElement = node;
        if (isGitHubCodeTable(table)) {
          return {
            conversion: convertTableElement,
            priority: 4,
          };
        }
        return null;
      },
      td: (node: Node) => {
        // $FlowFixMe[incompatible-type] element is a <td> since we matched it by nodeName
        const td: HTMLTableCellElement = node;
        // $FlowFixMe[incompatible-type] we know this will be a table, or null.
        const table: ?HTMLTableElement | null = td.closest('table');

        if (isGitHubCodeCell(td)) {
          return {
            conversion: convertTableCellElement,
            priority: 4,
          };
        }
        if (table && isGitHubCodeTable(table)) {
          // Return a no-op if it's a table cell in a code table, but not a code line.
          // Otherwise it'll fall back to the T
          return {
            conversion: convertCodeNoop,
            priority: 4,
          };
        }

        return null;
      },
      tr: (node: Node) => {
        // $FlowFixMe[incompatible-type] element is a <tr> since we matched it by nodeName
        const tr: HTMLTableElement = node;
        // $FlowFixMe[incompatible-type] we know this will be a table, or null.
        const table: ?HTMLTableElement | null = tr.closest('table');
        if (table && isGitHubCodeTable(table)) {
          return {
            conversion: convertCodeNoop,
            priority: 4,
          };
        }
        return null;
      },
    };
  }

  // Mutation
  canInsertTab(): true {
    return true;
  }

  setLanguage(language: string): void {
    const writable = this.getWritable();
    writable.__language = language;
  }

  getLanguage(): string | void {
    return this.getLatest().__language;
  }
}

export function $createCodeNode(language?: string): CodeNode {
  return new CodeNode(language);
}

export function $isCodeNode(node: ?LexicalNode): boolean %checks {
  return node instanceof CodeNode;
}

function convertPreElement(domNode: Node): DOMConversionOutput {
  return {node: $createCodeNode()};
}

function convertDivElement(domNode: Node): DOMConversionOutput {
  // $FlowFixMe[incompatible-type] domNode is a <div> since we matched it by nodeName
  const div: HTMLDivElement = domNode;
  return {
    after: (childLexicalNodes) => {
      const domParent = domNode.parentNode;
      if (domParent != null && domNode !== domParent.lastChild) {
        childLexicalNodes.push($createLineBreakNode());
      }
      return childLexicalNodes;
    },
    node: isCodeElement(div) ? $createCodeNode() : null,
  };
}

function convertTableElement(): DOMConversionOutput {
  return {node: $createCodeNode()};
}

function convertCodeNoop(): DOMConversionOutput {
  return {node: null};
}

function convertTableCellElement(domNode: Node): DOMConversionOutput {
  // $FlowFixMe[incompatible-type] domNode is a <td> since we matched it by nodeName
  const cell: HTMLTableCellElement = domNode;

  return {
    after: (childLexicalNodes) => {
      if (cell.parentNode && cell.parentNode.nextSibling) {
        // Append newline between code lines
        childLexicalNodes.push($createLineBreakNode());
      }
      return childLexicalNodes;
    },
    node: null,
  };
}

function isCodeElement(div: HTMLDivElement): boolean {
  return div.style.fontFamily.match('monospace') !== null;
}

function isGitHubCodeCell(cell: HTMLTableCellElement): boolean %checks {
  return cell.classList.contains('js-file-line');
}

function isGitHubCodeTable(table: HTMLTableElement): boolean %checks {
  return table.classList.contains('js-file-line-container');
}
