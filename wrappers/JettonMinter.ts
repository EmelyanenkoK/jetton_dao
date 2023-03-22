import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, internal, storeMessageRelaxed} from 'ton-core';

export type JettonMinterConfig = {admin: Address; content: Cell; wallet_code: Cell, voting_code: Cell, vote_keeper_code: Cell};

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    return beginCell()
                      .storeCoins(0)
                      .storeAddress(config.admin)
                      .storeRef(config.content)
                      .storeRef(config.wallet_code)
                      .storeUint(0, 64)
                      .storeRef(config.voting_code)
                      .storeRef(config.vote_keeper_code)
           .endCell();
}

export class JettonMinter implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonMinter(address);
    }

    static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonMinterConfigToCell(config);
        const init = { code, data };
        return new JettonMinter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    static mintMessage(to: Address, jetton_amount: bigint, forward_ton_amount: bigint, total_ton_amount: bigint,) {
        return beginCell().storeUint(0x1674b0a0, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(to).storeCoins(jetton_amount)
                          .storeCoins(forward_ton_amount).storeCoins(total_ton_amount)
               .endCell();
    }
    async sendMint(provider: ContractProvider, via: Sender, to: Address, jetton_amount: bigint, forward_ton_amount: bigint, total_ton_amount: bigint,) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.mintMessage(to, jetton_amount, forward_ton_amount, total_ton_amount,),
            value: total_ton_amount + toNano("0.1"),
        });
    }

    /* provide_wallet_address#2c76b973 query_id:uint64 owner_address:MsgAddress include_address:Bool = InternalMsgBody;
    */
    static discoveryMessage(owner: Address, include_address: boolean) {
        return beginCell().storeUint(0x2c76b973, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(owner).storeBit(include_address)
               .endCell();
    }

    async sendDiscovery(provider: ContractProvider, via: Sender, owner: Address, include_address: boolean) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.discoveryMessage(owner, include_address),
            value: toNano("0.1"),
        });
    }

    static changeAdminMessage(newOwner: Address) {
        return beginCell().storeUint(0x4840664f, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(newOwner)
               .endCell();
    }

    async sendChangeAdmin(provider: ContractProvider, via: Sender, newOwner: Address) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeAdminMessage(newOwner),
            value: toNano("0.1"),
        });
    }
    static changeContentMessage(content: Cell) {
        return beginCell().storeUint(0x5773d1f5, 32).storeUint(0, 64) // op, queryId
                          .storeRef(content)
               .endCell();
    }

    async sendChangeContent(provider: ContractProvider, via: Sender, content: Cell) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeContentMessage(content),
            value: toNano("0.1"),
        });
    }

    static createProposalBody(minimal_execution_amount:bigint, forwardMsg:Cell) {

        return beginCell().storeCoins(minimal_execution_amount).storeRef(forwardMsg).endCell();
    }

    static createVotingMessage(expiration_date: bigint,
                               minimal_execution_amount:bigint,
                               destination: Address, amount:bigint, payload:Cell) {
        let forwardMsgBuilder = beginCell();
        //storeMessageRelaxed(internal({to:destination, value:amount, body:payload}))(forwardMsgBuilder);
        let forwardMsg = forwardMsgBuilder.endCell();
        let proposal   = JettonMinter.createProposalBody(minimal_execution_amount, payload);
        return beginCell().storeUint(0x1c7f9a1a, 32).storeUint(0, 64) // op, queryId
                          .storeUint(expiration_date, 48)
                          .storeRef(proposal)
               .endCell();
    }

    async sendCreateVoting(provider: ContractProvider, via: Sender, expiration_date: bigint,
                           minimal_execution_amount:bigint,
                           destination: Address, amount:bigint, payload:Cell) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.createVotingMessage(expiration_date, minimal_execution_amount, destination, amount, payload),
            value: toNano("0.1") + minimal_execution_amount,
        });
    }

    static createExecuteVotingMessage(voting_id:bigint,
                                      expiration_date: bigint,
                                      voted_for:bigint,
                                      voted_against:bigint,
                                      payload: Cell,
                                      query_id:bigint = 0n) {
        return beginCell().storeUint(0x4f0f7510, 32)
                          .storeUint(query_id, 64)
                          .storeUint(voting_id, 64)
                          .storeUint(expiration_date, 48)
                          .storeCoins(voted_for)
                          .storeCoins(voted_against)
                          .storeRef(payload)
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
            body: JettonMinter.createExecuteVotingMessage(voting_id,
                                                          expiration_date,
                                                          voted_for,
                                                          voted_against,
                                                          payload),
            value: toNano("0.1")
        });

    }

    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const res = await provider.get('get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(owner).endCell() }])
        return res.stack.readAddress()
    }

    async getJettonData(provider: ContractProvider) {
        let res = await provider.get('get_jetton_data', []);
        let totalSupply = res.stack.readBigNumber();
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();
        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode
        };
    }

    async getTotalSupply(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.totalSupply;
    }
    async getAdminAddress(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.adminAddress;
    }
    async getContent(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.content;
    }

    async getVotingAddress(provider: ContractProvider, voting_id:bigint): Promise<Address> {
        const res = await provider.get('get_voting_address', [{ type: 'int', value: voting_id}])
        return res.stack.readAddress()
    }

    async getVotingCode(provider: ContractProvider): Promise<Cell> {
        const res = await provider.get('get_voting_code', [])
        return res.stack.readCell();
    }
}
