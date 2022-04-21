/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {BlockTransformer, TextTransformer} from './MarkdownPlugin';
import type {CodeNode} from '@lexical/code';
import type {RootNode, TextNode} from 'lexical';

import {$createCodeNode} from '@lexical/code';
import {$createLinkNode} from '@lexical/link';
import {$createParagraphNode, $createTextNode, $getRoot} from 'lexical';

const CODE_BLOCK_REG_EXP = /^```(\w{1,10})?\s?$/;
const LINK_REG_EXP = /(?:\[([^[]+)\])(?:\(([^(]+)\))/;

type TextTransformersIndex = $ReadOnly<{
  byTag: $ReadOnly<{[string]: TextTransformer}>,
  fullMatchRegExpByTag: $ReadOnly<{[string]: RegExp}>,
  openTagsRegExp: RegExp,
}>;

/**
 * Creates markdown importer method using block and text transformers
 * configuration. Main steps in converting markdown into lexical nodes:
 *
 *  - convert lines into root level blocks
 *  - process text content within those blocks by finding outermost markdown tags
 *    and recursively parsing inner content (e.g. when ~~ nested within * tags)
 *  - once formats are applied checking for links (since markdown links do not
 *    support nested styles they can go last over leaf text content nodes)
 */
export function createMarkdownImporter(
  blockTransformers: Array<BlockTransformer>,
  textTransformers: Array<TextTransformer>,
): (markdownString: string) => void {
  const textTransformersIndex = createTextTransformersIndex(textTransformers);
  return (markdownString: string) => {
    const lines = markdownString.split('\n');
    const linesLength = lines.length;
    const root = $getRoot();
    root.clear();

    for (let i = 0; i < linesLength; i++) {
      const lineText = lines[i];

      // Codeblocks are processed first as anything inside such block
      // is ignored during further processing
      const [codeBlockNode, shiftedIndex] = runCodeBlockTransformers(
        lines,
        i,
        root,
      );
      if (codeBlockNode != null) {
        i = shiftedIndex;
        continue;
      }

      runBlockTransformers(
        lineText,
        root,
        blockTransformers,
        textTransformersIndex,
      );
    }

    root.selectEnd();
  };
}

function runBlockTransformers(
  lineText: string,
  rootNode: RootNode,
  blockTransformers: Array<BlockTransformer>,
  textTransformersIndex: TextTransformersIndex,
) {
  const textNode = $createTextNode(lineText);
  const elementNode = $createParagraphNode();
  elementNode.append(textNode);
  rootNode.append(elementNode);

  for (const [matcher, replacer] of blockTransformers) {
    const match = lineText.match(matcher);
    if (match) {
      textNode.setTextContent(lineText.slice(match[0].length));
      replacer(elementNode, [textNode], match, true);
      break;
    }
  }

  runTextTransformers(textNode, textTransformersIndex);
}

// Processing text content and replaces markdown tags with node's formats.
// It takes outermost match of tag and its content, creates text node with
// format based on tag and then recursively executed over node's content
//
// E.g. for "*Hello **world**!*" string it will create text node with
// "Hello **world**!" content and italic format and run recursive call over
// its content to transform "**world**" part
function runTextTransformers(
  textNode: TextNode,
  textTransformersIndex: TextTransformersIndex,
) {
  const textContent = textNode.getTextContent();
  const match = findOutermostMatch(textContent, textTransformersIndex);

  if (!match) {
    // When done with text transformers can check for links. Text transformers are executed first
    // as it might contain inline code blocks which prevent any further transformations
    runLinkTransformers(textNode);
    return;
  }

  let currentNode, remainderNode;
  // If matching full content there's no need to run splitText and can
  // reuse existing textNode to update its content and apply format
  if (match[0] === textContent) {
    currentNode = textNode;
  } else {
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;
    if (startIndex === 0) {
      [currentNode, remainderNode] = textNode.splitText(endIndex);
    } else {
      [, currentNode, remainderNode] = textNode.splitText(startIndex, endIndex);
    }
  }
  currentNode.setTextContent(match[2]);

  const transformer = textTransformersIndex.byTag[match[1]];
  if (transformer) {
    for (const format of transformer.format) {
      if (!currentNode.hasFormat(format)) {
        currentNode.toggleFormat(format);
      }
    }
  }

  // Recursively run over inner text if it's not inline code
  if (!currentNode.hasFormat('code')) {
    runTextTransformers(currentNode, textTransformersIndex);
  }

  // Run over remaining text if any
  if (remainderNode) {
    runTextTransformers(remainderNode, textTransformersIndex);
  }
}

function runCodeBlockTransformers(
  lines: Array<string>,
  startLineIndex: number,
  rootNode: RootNode,
): [CodeNode | null, number] {
  const openMatch = lines[startLineIndex].match(CODE_BLOCK_REG_EXP);

  if (openMatch) {
    let endLineIndex = startLineIndex;
    const linesLength = lines.length;
    while (++endLineIndex < linesLength) {
      const closeMatch = lines[endLineIndex].match(CODE_BLOCK_REG_EXP);
      if (closeMatch) {
        const codeBlockNode = $createCodeNode(openMatch[1]);
        const textNode = $createTextNode(
          lines.slice(startLineIndex + 1, endLineIndex).join('\n'),
        );
        codeBlockNode.append(textNode);
        rootNode.append(codeBlockNode);
        return [codeBlockNode, endLineIndex];
      }
    }
  }

  return [null, startLineIndex];
}

function runLinkTransformers(textNode_: TextNode) {
  let textNode = textNode_;

  while (textNode) {
    const match = textNode.getTextContent().match(LINK_REG_EXP);
    if (!match) {
      return false;
    }

    const [fullMatch, linkText, linkUrl] = match;
    const startIndex = match.index;
    const endIndex = startIndex + fullMatch.length;
    let replaceNode;
    if (startIndex === 0) {
      [replaceNode, textNode] = textNode.splitText(endIndex);
    } else {
      [, replaceNode, textNode] = textNode.splitText(startIndex, endIndex);
    }

    const linkNode = $createLinkNode(linkUrl);
    const linkTextNode = $createTextNode(linkText);
    linkTextNode.setFormat(replaceNode.getFormat());
    linkNode.append(linkTextNode);
    replaceNode.replace(linkNode);
  }
}

// Finds first "<tag>content</tag>" match that is not nested into another tag
function findOutermostMatch(
  textContent: string,
  textTransformersIndex: TextTransformersIndex,
): RegExp$matchResult | null {
  const openTagsMatch = textContent.match(textTransformersIndex.openTagsRegExp);
  if (openTagsMatch == null) {
    return null;
  }

  for (const match of openTagsMatch) {
    // Open tags reg exp might capture leading space so removing it
    // before using match to find transformer
    const fullMatchRegExp =
      textTransformersIndex.fullMatchRegExpByTag[match.replace(/^\s/, '')];
    if (fullMatchRegExp == null) {
      continue;
    }

    const fullMatch = textContent.match(fullMatchRegExp);
    if (fullMatch != null) {
      return fullMatch;
    }
  }

  return null;
}

function createTextTransformersIndex(
  textTransformers: Array<TextTransformer>,
): TextTransformersIndex {
  const byTag = {};
  const fullMatchRegExpByTag = {};
  const openTagsRegExp = [];
  for (const transformer of textTransformers) {
    const {tag} = transformer;
    byTag[tag] = transformer;
    const tagRegExp = tag.replace(/\*/g, '\\*');
    openTagsRegExp.push(tagRegExp);
    // RegExp to match specific tag group (open tag + content + close tag)
    fullMatchRegExpByTag[tag] = new RegExp(
      `(${tagRegExp})(?![${tagRegExp}\\s])(.*?[^${tagRegExp}\\s])${tagRegExp}(?!${tagRegExp})`,
    );
  }

  return {
    byTag,
    fullMatchRegExpByTag,
    // RegExp to match all possible open tags
    openTagsRegExp: new RegExp('(' + openTagsRegExp.join('|') + ')', 'g'),
  };
}
