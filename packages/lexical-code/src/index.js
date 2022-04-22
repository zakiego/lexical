/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

// eslint-disable-next-line simple-import-sort/imports
import Prism from 'prismjs/components/prism-core';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-objectivec';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-swift';

import type {LexicalEditor, LexicalNode, LexicalCommand} from 'lexical';

import {mergeRegister} from '@lexical/utils';
import {
  $createTextNode,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  TextNode,
  INDENT_CONTENT_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import {
  CodeHighlightNode,
  $createCodeHighlightNode,
  $isCodeHighlightNode,
} from './CodeHighlightNode';
import {
  getFirstCodeHighlightNodeOfLine,
  getLastCodeHighlightNodeOfLine,
} from './utils';
import {$isCodeNode, $createCodeNode, CodeNode} from './CodeNode';
import {
  $createCodeLineNode,
  $isCodeLineNode,
  CodeLineNode,
} from './CodeLineNode';

export {
  $createCodeHighlightNode,
  $createCodeNode,
  $isCodeHighlightNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeLineNode,
  CodeNode,
};

const DEFAULT_CODE_LANGUAGE = 'javascript';

export const getDefaultCodeLanguage = (): string => DEFAULT_CODE_LANGUAGE;

export const getCodeLanguages = (): Array<string> =>
  Object.keys(Prism.languages)
    .filter(
      // Prism has several language helpers mixed into languages object
      // so filtering them out here to get langs list
      (language) => typeof Prism.languages[language] !== 'function',
    )
    .sort();

function textNodeTransform(node: TextNode, editor: LexicalEditor): void {
  const parentNode = node.getParent();
  if ($isCodeLineNode(parentNode)) {
    codeLineNodeTransform(parentNode, editor);
  } else if ($isCodeHighlightNode(node)) {
    // When code block converted into paragraph or other element
    // code highlight nodes converted back to normal text
    node.replace($createTextNode(node.__text));
  }
}

function codeLineNodeTransform(node: CodeLineNode, editor: LexicalEditor) {
  const parentNode = node.getParent();
  if ($isCodeNode(parentNode)) {
    codeNodeTransform(parentNode, editor);
  }
}

// Using `skipTransforms` to prevent extra transforms since reformatting the code
// will not affect code block content itself.
//
// Using extra flag (`isHighlighting`) since both CodeNode and CodeHighlightNode
// trasnforms might be called at the same time (e.g. new CodeHighlight node inserted) and
// in both cases we'll rerun whole reformatting over CodeNode, which is redundant.
// Especially when pasting code into CodeBlock.
let isHighlighting = false;
function codeNodeTransform(node: CodeNode, editor: LexicalEditor) {
  if (isHighlighting) {
    return;
  }
  isHighlighting = true;
  // When new code block inserted it might not have language selected
  if (node.getLanguage() === undefined) {
    node.setLanguage(DEFAULT_CODE_LANGUAGE);
  }

  // Using nested update call to pass `skipTransforms` since we don't want
  // each individual codehighlight node to be transformed again as it's already
  // in its final state
  editor.update(
    () => {
      updateAndRetainSelection(node, () => {
        const code = node.getTextContent().replace(/\n\n/g, '\n');
        const tokens = Prism.tokenize(
          code,
          Prism.languages[node.getLanguage() || ''] ||
            Prism.languages[DEFAULT_CODE_LANGUAGE],
        );

        node.clear();

        // TODO: add bulk
        const linesNodes = getLinesNodes(tokens);
        for (const line of linesNodes) {
          const codeLineNode = $createCodeLineNode();
          codeLineNode.append(...line);
          node.append(codeLineNode);
        }

        // $FlowFixMe[incompatible-cast]
        // const children = (node.getChildren(): Array<CodeLineNode>);

        // console.log(
        //   getDiffRange(
        //     children.map(line => {
        //       return line.getChildren();
        //     }),
        //     linesNodes,
        //   ),
        // );

        return true;

        // const {from, to, nodesForReplacement} = diffRange;
        // if (from !== to || nodesForReplacement.length) {
        //   node.splice(from, to - from, nodesForReplacement);
        //   return true;
        // }
        // return false;
      });
    },
    {
      onUpdate: () => {
        isHighlighting = false;
      },
      skipTransforms: true,
    },
  );
}

function getLinesNodes(
  tokensStream: TokenStream,
): Array<Array<CodeHighlightNode>> {
  const codeLines = [[]];

  function push(...nodes) {
    codeLines[codeLines.length - 1].push(...nodes);
  }

  function recurse(tokens) {
    tokens.forEach((token) => {
      if (typeof token === 'string') {
        const partials = token.split('\n');
        for (let i = 0; i < partials.length; i++) {
          const text = partials[i];
          if (text.length) {
            push($createCodeHighlightNode(text));
          }
          if (i < partials.length - 1) {
            codeLines.push([]);
          }
        }
      } else {
        const {content} = token;
        if (typeof content === 'string') {
          push($createCodeHighlightNode(content, token.type));
        } else if (content.length === 1 && typeof content[0] === 'string') {
          push($createCodeHighlightNode(content[0], token.type));
        } else {
          recurse(content);
        }
      }
    });
  }

  recurse(tokensStream);

  return codeLines;
}

// Wrapping update function into selection retainer, that tries to keep cursor at the same
// position as before.
function updateAndRetainSelection(
  node: CodeNode,
  updateFn: () => boolean,
): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.anchor) {
    return;
  }

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  const anchorOffset = anchor.offset;
  const isTextAnchor = anchor.type === 'text';
  const lineIndex = isTextAnchor
    ? anchorNode.getParentOrThrow().getIndexWithinParent()
    : anchorNode.getIndexWithinParent();
  let textOffset = 0;

  // Calculating previous text offset (all text node prior to anchor + anchor own text offset)
  if (isTextAnchor) {
    textOffset =
      anchorOffset +
      anchorNode.getPreviousSiblings().reduce((offset, _node) => {
        return (
          offset + ($isLineBreakNode(_node) ? 0 : _node.getTextContentSize())
        );
      }, 0);
  }

  const hasChanges = updateFn();
  if (!hasChanges) {
    return;
  }

  // If it was text anchor then we walk through child nodes
  // and looking for a position of original text offset
  if (isTextAnchor) {
    const nextCodeLine = node.getChildAtIndex(lineIndex);
    if ($isCodeLineNode(nextCodeLine)) {
      nextCodeLine.getChildren().some((_node) => {
        if ($isCodeHighlightNode(_node)) {
          const textContentSize = _node.getTextContentSize();
          if (textContentSize >= textOffset) {
            _node.select(textOffset, textOffset);
            return true;
          }
          textOffset -= textContentSize;
        }
        return false;
      });
    }
  } else {
    anchor.getNode().select(anchorOffset, anchorOffset);
    return;
  }
}

// Finds minimal diff range between two nodes lists. It returns from/to range boundaries of prevNodes
// that needs to be replaced with `nodes` (subset of nextNodes) to make prevNodes equal to nextNodes.
function getDiffRange(
  prevNodes: Array<LexicalNode>,
  nextNodes: Array<LexicalNode>,
): {
  from: number,
  nodesForReplacement: Array<LexicalNode>,
  to: number,
} {
  let leadingMatch = 0;
  while (leadingMatch < prevNodes.length) {
    if (!isEqual(prevNodes[leadingMatch], nextNodes[leadingMatch])) {
      break;
    }
    leadingMatch++;
  }

  const prevNodesLength = prevNodes.length;
  const nextNodesLength = nextNodes.length;
  const maxTrailingMatch =
    Math.min(prevNodesLength, nextNodesLength) - leadingMatch;

  let trailingMatch = 0;
  while (trailingMatch < maxTrailingMatch) {
    trailingMatch++;
    if (
      !isEqual(
        prevNodes[prevNodesLength - trailingMatch],
        nextNodes[nextNodesLength - trailingMatch],
      )
    ) {
      trailingMatch--;
      break;
    }
  }

  const from = leadingMatch;
  const to = prevNodesLength - trailingMatch;
  const nodesForReplacement = nextNodes.slice(
    leadingMatch,
    nextNodesLength - trailingMatch,
  );
  return {
    from,
    nodesForReplacement,
    to,
  };
}

function isEqual(nodeA: LexicalNode, nodeB: LexicalNode): boolean {
  // Only checking for code higlight nodes and linebreaks. If it's regular text node
  // returning false so that it's transformed into code highlight node
  if ($isCodeHighlightNode(nodeA) && $isCodeHighlightNode(nodeB)) {
    return (
      nodeA.__text === nodeB.__text &&
      nodeA.__highlightType === nodeB.__highlightType
    );
  }

  if ($isLineBreakNode(nodeA) && $isLineBreakNode(nodeB)) {
    return true;
  }

  return false;
}

function handleMultilineIndent(type: LexicalCommand<void>): boolean {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return false;
  }

  // Only run multiline indent logic on selections exclusively composed of code highlights and linebreaks
  const nodes = selection.getNodes();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!$isCodeHighlightNode(node) && !$isLineBreakNode(node)) {
      return false;
    }
  }
  const startOfLine = getFirstCodeHighlightNodeOfLine(nodes[0]);

  if (startOfLine != null) {
    doIndent(startOfLine, type);
  }

  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    if ($isLineBreakNode(nodes[i - 1]) && $isCodeHighlightNode(node)) {
      doIndent(node, type);
    }
  }

  return true;
}

function doIndent(node: CodeHighlightNode, type: LexicalCommand<void>) {
  const text = node.getTextContent();
  if (type === INDENT_CONTENT_COMMAND) {
    // If the codeblock node doesn't start with whitespace, we don't want to
    // naively prepend a '\t'; Prism will then mangle all of our nodes when
    // it separates the whitespace from the first non-whitespace node. This
    // will lead to selection bugs when indenting lines that previously
    // didn't start with a whitespace character
    if (text.length > 0 && /\s/.test(text[0])) {
      node.setTextContent('\t' + text);
    } else {
      const indentNode = $createCodeHighlightNode('\t');
      node.insertBefore(indentNode);
    }
  } else {
    if (text.indexOf('\t') === 0) {
      // Same as above - if we leave empty text nodes lying around, the resulting
      // selection will be mangled
      if (text.length === 1) {
        node.remove();
      } else {
        node.setTextContent(text.substring(1));
      }
    }
  }
}

function handleShiftLines(
  type: LexicalCommand<KeyboardEvent>,
  event: KeyboardEvent,
): boolean {
  // We only care about the alt+arrow keys
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }

  // I'm not quite sure why, but it seems like calling anchor.getNode() collapses the selection here
  // So first, get the anchor and the focus, then get their nodes
  const {anchor, focus} = selection;
  const anchorOffset = anchor.offset;
  const focusOffset = focus.offset;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  const arrowIsUp = type === KEY_ARROW_UP_COMMAND;

  // Ensure the selection is within the codeblock
  if (!$isCodeHighlightNode(anchorNode) || !$isCodeHighlightNode(focusNode)) {
    return false;
  }
  if (!event.altKey) {
    // Handle moving selection out of the code block, given there are no
    // sibling thats can natively take the selection.
    if (selection.isCollapsed()) {
      const codeNode = anchorNode.getParentOrThrow();
      if (
        arrowIsUp &&
        anchorOffset === 0 &&
        anchorNode.getPreviousSibling() === null
      ) {
        const codeNodeSibling = codeNode.getPreviousSibling();
        if (codeNodeSibling === null) {
          codeNode.selectPrevious();
          event.preventDefault();
          return true;
        }
      } else if (
        !arrowIsUp &&
        anchorOffset === anchorNode.getTextContentSize() &&
        anchorNode.getNextSibling() === null
      ) {
        const codeNodeSibling = codeNode.getNextSibling();
        if (codeNodeSibling === null) {
          codeNode.selectNext();
          event.preventDefault();
          return true;
        }
      }
    }
    return false;
  }

  const start = getFirstCodeHighlightNodeOfLine(anchorNode);
  const end = getLastCodeHighlightNodeOfLine(focusNode);
  if (start == null || end == null) {
    return false;
  }

  const range = start.getNodesBetween(end);
  for (let i = 0; i < range.length; i++) {
    const node = range[i];
    if (!$isCodeHighlightNode(node) && !$isLineBreakNode(node)) {
      return false;
    }
  }

  // After this point, we know the selection is within the codeblock. We may not be able to
  // actually move the lines around, but we want to return true either way to prevent
  // the event's default behavior
  event.preventDefault();
  event.stopPropagation(); // required to stop cursor movement under Firefox

  const linebreak = arrowIsUp
    ? start.getPreviousSibling()
    : end.getNextSibling();
  if (!$isLineBreakNode(linebreak)) {
    return true;
  }
  const sibling = arrowIsUp
    ? linebreak.getPreviousSibling()
    : linebreak.getNextSibling();
  if (sibling == null) {
    return true;
  }

  const maybeInsertionPoint = arrowIsUp
    ? getFirstCodeHighlightNodeOfLine(sibling)
    : getLastCodeHighlightNodeOfLine(sibling);
  let insertionPoint =
    maybeInsertionPoint != null ? maybeInsertionPoint : sibling;
  linebreak.remove();
  range.forEach((node) => node.remove());
  if (type === KEY_ARROW_UP_COMMAND) {
    range.forEach((node) => insertionPoint.insertBefore(node));
    insertionPoint.insertBefore(linebreak);
  } else {
    insertionPoint.insertAfter(linebreak);
    insertionPoint = linebreak;
    range.forEach((node) => {
      insertionPoint.insertAfter(node);
      insertionPoint = node;
    });
  }

  selection.setTextNodeRange(anchorNode, anchorOffset, focusNode, focusOffset);

  return true;
}

export function registerCodeHighlighting(editor: LexicalEditor): () => void {
  if (!editor.hasNodes([CodeNode, CodeHighlightNode])) {
    throw new Error(
      'CodeHighlightPlugin: CodeNode or CodeHighlightNode not registered on editor',
    );
  }

  return mergeRegister(
    editor.registerNodeTransform(CodeNode, (node) =>
      codeNodeTransform(node, editor),
    ),
    editor.registerNodeTransform(TextNode, (node) =>
      textNodeTransform(node, editor),
    ),
    editor.registerNodeTransform(CodeHighlightNode, (node) =>
      textNodeTransform(node, editor),
    ),
    editor.registerNodeTransform(CodeLineNode, (node) =>
      codeLineNodeTransform(node, editor),
    ),
    editor.registerCommand(
      INDENT_CONTENT_COMMAND,
      (payload): boolean => handleMultilineIndent(INDENT_CONTENT_COMMAND),
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      OUTDENT_CONTENT_COMMAND,
      (payload): boolean => handleMultilineIndent(OUTDENT_CONTENT_COMMAND),
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (payload): boolean => handleShiftLines(KEY_ARROW_UP_COMMAND, payload),
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (payload): boolean => handleShiftLines(KEY_ARROW_DOWN_COMMAND, payload),
      COMMAND_PRIORITY_LOW,
    ),
  );
}
