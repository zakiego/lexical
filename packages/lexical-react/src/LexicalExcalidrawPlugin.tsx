/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type {LexicalCommand} from 'lexical';
import type {Modal, Excalidraw} from '@lexical/excalidraw';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical';
import {useEffect} from 'react';

import {$createExcalidrawNode, ExcalidrawNode, ExcalidrawImage} from '@lexical/excalidraw';

export const INSERT_EXCALIDRAW_COMMAND: LexicalCommand<void> = createCommand();
export function ExcalidrawPlugin({modal, excalidraw, excalidrawImage}: {modal: Modal, excalidraw: Excalidraw, excalidrawImage: ExcalidrawImage}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!editor.hasNodes([ExcalidrawNode])) {
      throw new Error(
        'ExcalidrawPlugin: ExcalidrawNode not registered on editor',
      );
    }

    return editor.registerCommand(
      INSERT_EXCALIDRAW_COMMAND,
      () => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          const excalidrawNode = $createExcalidrawNode(excalidraw, excalidrawImage, modal);
          selection.insertNodes([excalidrawNode]);
        }

        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  return null;
}

export {ExcalidrawNode};
