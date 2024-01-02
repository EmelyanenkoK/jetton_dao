import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';
import { Op } from "../Ops";

export type VotingResultsConfig = {
    voting_body: Cell,
    voting_duration: number,
    dao_address: Address,
};

export type VotingResultsData = {
    init: boolean;
    votingBody: Cell;
    votingDuration: number;
    daoAddress: Address;
    votingEnding: bigint;
    votingId: bigint;
    votesFor: bigint;
    votesAgainst: bigint;
}

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

    async sendProvideVoteResult(provider: ContractProvider, via: Sender, value: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(Op.results.provide_voting_results, 32)
                             .storeUint(query_id, 64)
                             .endCell(),
        });
    }

/*
      return (init?, voting_body, voting_duration, dao_address,
              voting_ending, voting_id, votes_for, votes_against);
*/
    async getData(provider: ContractProvider) {
        let { stack } = await provider.get('get_voting_results', []);
        let init = stack.readBoolean();
        let votingBody = stack.readCell();
        let votingDuration = stack.readNumber();
        let daoAddress = stack.readAddress();
        let votingEnding = stack.readBigNumber();
        let votingId = stack.readBigNumber();
        let votesFor = stack.readBigNumber();
        let votesAgainst = stack.readBigNumber();
        return {init, votingBody, votingDuration, daoAddress,
                 votingEnding, votingId, votesFor, votesAgainst};
    }
/*
    take_voting_results query_id:uint64 voting_body:^Cell voting_duration:uint48
                        dao_address:MsgAddress voting_ending:uint48 voting_id:uint64
                        votes_for:Coins votes_against:Coins
                        = InternalMsgBody;
*/
    static parseProvidedVoteResult(msgBody: Cell): VotingResultsData {
        let cs = msgBody.beginParse();
        let op = cs.loadUint(32); // Op
        if (op != Op.results.take_voting_results)
            throw new Error(`Invalid op: ${op}`);
        cs.loadUint(64); // query_id
        let init = cs.loadBit();
        let votingBody = cs.loadRef();
        let votingDuration = cs.loadUint(48);
        let daoAddress = cs.loadAddress();
        let votingEnding: bigint;
        let votingId: bigint;
        let votesFor: bigint;
        let votesAgainst: bigint;
        if (!init) {
            votingEnding = 0n;
            votingId = -1n;
            votesFor = 0n;
            votesAgainst = 0n;
        } else {
            votingEnding = cs.loadUintBig(48);
            votingId = cs.loadUintBig(64);
            votesFor = cs.loadCoins();
            votesAgainst = cs.loadCoins();
        }
        return {init, votingBody, votingDuration, daoAddress,
                 votingEnding, votingId, votesFor, votesAgainst};
    }
}
