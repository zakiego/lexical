/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const {exec} = require('child-process-promise');
const path = require('path');

async function buildFlowDeclarationFiles(packageName, outputPath) {
  await exec(
    `find ${path.resolve(
      '.ts-temp/',
    )} -type f -name "**/*.d.ts" -exec sh -c "flowgen --add-flow-header $1 -o ./.flow-temp/\${1%.*.*\}.js.flow" _ "{}" \\;`,
    (err) => {
      console.error(err);
    },
  );
}

buildFlowDeclarationFiles();
