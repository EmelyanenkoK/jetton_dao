import { CompilerConfig } from '@ton/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { compile as compileFunc } from '@ton/blueprint';



export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        await compileFunc('JettonWallet');
    },
    targets: [ 'contracts/auto/voting-results-code.func',
               'contracts/auto/jetton-wallet-code.func',
               'tests/dao/minter-upd.func'],
}
