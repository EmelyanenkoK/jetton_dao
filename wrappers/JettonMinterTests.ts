import { Address, Cell, beginCell, Sender, ContractProvider, SendMode, toNano, contractAddress } from "ton-core";
import { Op } from "../Ops";
import { JettonMinter, JettonMinterConfig, jettonMinterConfigToCell } from "./JettonMinter";
export class JettonMinterTests extends JettonMinter {
    constructor (readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
        super(address, init);
    }

    static createFromAddress(address:Address) {
        return new JettonMinterTests(address);
    }

    static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonMinterConfigToCell(config);
        const init = { code, data };
        return new JettonMinterTests(contractAddress(workchain, init), init);
    }

    static createExecuteVotingMessage(voting_id:bigint,
                                      expiration_date: bigint,
                                      voted_for:bigint,
                                      voted_against:bigint,
                                      payload: Cell,
                                      query_id:bigint = 0n) {
        return beginCell().storeUint(Op.minter.execute_vote_result, 32)
                          .storeUint(query_id, 64)
                          .storeUint(voting_id, 64)
                          .storeUint(expiration_date, 48)
                          .storeCoins(voted_for)
                          .storeCoins(voted_against)
                          .storeMaybeRef(payload)
               .endCell();
    }

    async sendExecuteVotingMessage(provider: ContractProvider,
                                   via: Sender,
                                   voting_id:bigint,
                                   expiration_date:bigint,
                                   voted_for:bigint,
                                   voted_against:bigint,
                                   payload:Cell,
                                  ) {

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinterTests.createExecuteVotingMessage(voting_id,
                                                          expiration_date,
                                                          voted_for,
                                                          voted_against,
                                                          payload),
            value: toNano("0.1")
        });

    }

    static createConfirmVotingMessage(voting_id:bigint, voter:Address, query_id:bigint = 0n) {
        return beginCell().storeUint(Op.minter.request_confirm_voting, 32)
                          .storeUint(query_id, 64)
                          .storeUint(voting_id, 64)
                          .storeAddress(voter)
               .endCell();
    }

    async sendConfirmVoting(provider: ContractProvider, via: Sender,
                            voting_id:bigint, voter: Address, value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinterTests.createConfirmVotingMessage(voting_id, voter),
            value
        });
    }

    static createVotingInitiated(voting_id:bigint, expiration_date:bigint, initiator:Address, query_id:bigint = 0n){
        return beginCell().storeUint(Op.minter.voting_initiated, 32)
                          .storeUint(query_id, 64)
                          .storeUint(voting_id, 64)
                          .storeUint(expiration_date, 48)
                          .storeAddress(initiator)
               .endCell();

    }

    async sendVotingInitiated(provider: ContractProvider,
                                    via: Sender,
                                    voting_id: bigint,
                                    expiration_date: bigint,
                                    initiator:Address,
                                    value:bigint=toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinterTests.createVotingInitiated(voting_id, expiration_date, initiator),
            value
        });
    }
}
