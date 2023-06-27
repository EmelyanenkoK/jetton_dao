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

/*
      return (init?, voting_body, voting_duration, dao_address,
              finished?, voting_id, votes_for, votes_against);
*/
    async getData(provider: ContractProvider) {
        let { stack } = await provider.get('get_voting_results', []);
        let init = stack.readBoolean();
        let votingBody = stack.readCellOpt();
        let votingDuration = stack.readNumber();
        let daoAddress = stack.readAddress();
        let finished = stack.readBoolean();
        let votingId = stack.readBigNumber();
        let votesFor = stack.readBigNumber();
        let votesAgainst = stack.readBigNumber();
        return {init, votingBody, votingDuration, daoAddress,
                 finished, votingId, votesFor, votesAgainst};
    }
}
