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

    static createVoteResult(votingId: bigint | number,
                            votedFor: bigint,
                            votedAgainst: bigint,
                            query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.minter.send_vote_result, 32).storeUint(query_id, 64)
                          .storeUint(votingId, 64).storeCoins(votedFor)
                          .storeCoins(votedAgainst)
               .endCell();
    }

    async sendVoteResult(provider: ContractProvider,
                         via: Sender,
                         votingId: bigint | number,
                         votedFor: bigint,
                         votedAgainst: bigint,
                         value: bigint = toNano('0.1'),
                         query_id: bigint | number = 0) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: VotingResults.createVoteResult(votingId, votedFor, votedAgainst, query_id),
        });
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
