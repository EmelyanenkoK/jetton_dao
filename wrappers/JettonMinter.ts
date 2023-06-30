import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, internal, storeMessageRelaxed} from 'ton-core';
import { Op } from '../Ops';
import { Voting } from './Voting';

export type JettonMinterContent = {
    type:0|1,
    uri:string
};
export type JettonMinterConfig = { admin: Address;
                                   content: Cell;
                                   voting_code: Cell
                                   };

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    return beginCell()
                      .storeCoins(0)
                      .storeAddress(config.admin)
                      .storeRef(config.content)
                      .storeUint(0, 64)
                      .storeRef(config.voting_code)
           .endCell();
}

export function jettonContentToCell(content:JettonMinterContent) {
    return beginCell()
                      .storeUint(content.type, 8)
                      .storeStringTail(content.uri) //Snake logic under the hood
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
        return beginCell().storeUint(Op.minter.mint, 32).storeUint(0, 64) // op, queryId
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
        return beginCell().storeUint(Op.minter.provide_wallet_address, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(owner).storeBit(include_address)
               .endCell();
    }

    async sendDiscovery(provider: ContractProvider, via: Sender, owner: Address, include_address: boolean, value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.discoveryMessage(owner, include_address),
            value,
        });
    }

    static changeAdminMessage(newOwner: Address) {
        return beginCell().storeUint(Op.minter.change_admin, 32).storeUint(0, 64) // op, queryId
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
        return beginCell().storeUint(Op.minter.change_content, 32).storeUint(0, 64) // op, queryId
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

    static createSimpleMsgVotingMessage(expiration_date: bigint,
                                        minimal_execution_amount:bigint,
                                        payload:Cell,
                                        description: string = "Sample description") {
        let forwardMsgBuilder = beginCell();
        // storeMessageRelaxed(internal({to:destination, value:amount, body:payload}))(forwardMsgBuilder);
        let forwardMsg = forwardMsgBuilder.endCell();
        let proposal = Voting.createSendMsgProposalBody(minimal_execution_amount, payload, description);
        return beginCell().storeUint(Op.minter.create_voting, 32).storeUint(0, 64) // op, queryId
                          .storeUint(expiration_date, 48)
                          .storeRef(proposal)
                          .storeUint(0, 64)
                       .endCell();
    }
    async sendCreateSimpleMsgVoting(provider: ContractProvider, via: Sender, expiration_date: bigint,
                           minimal_execution_amount:bigint,
                           payload:Cell,
                           description: string = "Sample description") {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.createSimpleMsgVotingMessage(expiration_date, minimal_execution_amount, payload, description),
            value: toNano("0.1") + minimal_execution_amount,
        });
    }

    static createPollVotingMessage(duration: bigint | number, body: string | Cell = "Sample description") {
        let voting_body = Voting.createPollProposal(duration, body);
        return beginCell().storeUint(Op.minter.create_voting, 32).storeUint(0, 64) // op, queryId
                          .storeUint(0, 48) // unused expiration date
                          .storeRef(voting_body)
                          .storeUint(1, 64) // voting type
                       .endCell();
    }

    async sendCreatePollVoting(provider: ContractProvider, via: Sender, duration: bigint | number,
                               body: string | Cell = "Sample description") {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.createPollVotingMessage(duration, body),
            value: toNano("0.1"),
        });
                               }
    static createCodeUpgradeMessage(minter_code: Cell | null, voting_code: Cell | null, query_id:bigint = 0n) {
        return beginCell().storeUint(Op.minter.upgrade_code, 32)
                          .storeUint(query_id, 64)
                          .storeMaybeRef(minter_code)
                          .storeMaybeRef(voting_code)
               .endCell();
    }

    async sendCodeUpgrade(provider: ContractProvider, via: Sender,
                          minter_code: Cell | null, 
                          voting_code: Cell | null,
                          value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.createCodeUpgradeMessage(minter_code, voting_code),
            value
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
