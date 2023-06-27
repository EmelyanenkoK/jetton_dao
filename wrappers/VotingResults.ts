import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';
import { Op } from "../Ops";

export type VotingResultsConfig = {
    voting_body: Cell,
    voting_duration: number,
    dao_address: Address,
};

export class VotingResults implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static votingResultsConfigToCell(conf: VotingResultsConfig) {
        return beginCell()
                  .storeBit(false) // init?
                  .storeRef(conf.voting_body)
                  .storeUint(conf.voting_duration, 48)
                  .storeAddress(conf.dao_address)
               .endCell();
    }
    static createFromAddress(address: Address) {
        return new VotingResults(address);
    }
    static createFromConfig(conf:VotingResultsConfig, code:Cell, workchain = 0) {
        const data = VotingResults.votingResultsConfigToCell(conf);
        const init = {code, data};
        return new VotingResults(contractAddress(workchain, init), init);
    }
}
