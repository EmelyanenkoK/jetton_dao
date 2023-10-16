import { CompilerConfig } from '@ton/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { compile as compileFunc } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        await compileFunc('VoteKeeper');
        await compileFunc('JettonWallet');
    },

    targets: ['contracts/auto/vote-keeper-code.func',
              'contracts/auto/jetton-wallet-code.func',
              'contracts/voting.func'],
    postCompileHook: async (code) => {
        const auto = path.join(__dirname, '..', 'contracts', 'auto');
        await mkdir(auto, { recursive: true });
        await writeFile(path.join(auto, 'voting-code.func'), `cell voting_code() asm "B{${code.toBoc().toString('hex')}} B>boc PUSHREF";`);
    }
};
