import { CompilerConfig } from '@ton-community/blueprint';
import { compile as local_compile } from '@ton-community/blueprint';


const voting_code = await local_compile('Voting');
const vote_keeper_code = await local_compile('VoteKeeper');


export const compile: CompilerConfig = {
    targets: ['contracts/jetton-minter.func'],
};
