
import { Address, toNano, fromNano } from "ton";
import {Cell, beginCell, Transaction } from "ton-core";
import { JettonWallet } from "../wrappers/JettonWallet";
import { VoteKeeperTests } from "../wrappers/VoteKeeperTests";
import { SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { VotingTests } from "../wrappers/VotingTests";

export type voteCtx = {
    init: boolean,
    votedFor: bigint,
    votedAgainst: bigint
};

export type ActiveWallet       = SandboxContract<TreasuryContract>;
export type ActiveJettonWallet = SandboxContract<JettonWallet>;

export type sortBalanceResult  = {
    min: ActiveJettonWallet,
    max: ActiveJettonWallet,
    maxBalance: bigint,
    minBalance: bigint,
    isEq: boolean,
    hasZero: boolean
};

export type walletDesc = {
    user:   ActiveWallet,
    jetton: ActiveJettonWallet,
    balance:bigint
}

export type pickWinnerResult = {
    winner: walletDesc,
    loser:  walletDesc
};

export const randomAddress = (wc: number = 0) => {
    const buf = Buffer.alloc(32);
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
    }
    return new Address(wc, buf);
};

export const differentAddress = (old:Address) => {
    let newAddress: Address;
    do {
        newAddress = randomAddress(old.workChain);
    } while(newAddress.equals(old));

    return newAddress;
}

export const getRandom = (min:number, max:number) => {
    return Math.random() * (max - min) + min;
}

enum roundMode {floor, ceil, round};

export const getRandomInt = (min:number, max:number, mode: roundMode = roundMode.floor) => {
    let res = getRandom(min, max);

    if(mode == roundMode.floor) {
        res = Math.floor(res);
    }
    else if(mode == roundMode.ceil) {
        res = Math.ceil(res);
    }
    else {
        res = Math.round(res);
    }

    return res;
}

export const getRandomTon = (min:number, max:number): bigint => {
    return toNano(getRandom(min, max).toFixed(9));
}

export const getRandomExp = (from:number = Math.floor(Date.now() / 1000)) => {
    return BigInt(from + getRandomInt(10, 12));
}

export const renewExp = (cur:bigint) => {
    return Math.floor(Date.now() / 1000) >= cur ? getRandomExp(Number(cur)) : cur;
}

export const getRandomPayload = (): Cell => {
    return beginCell().storeCoins(getRandomTon(1, 2000)).endCell();
}

export const commonMsg = (op:bigint | number, query_id:bigint | number = 0) => {
    return beginCell().storeUint(op, 32).storeUint(query_id, 64).endCell();
}

export const assertVoteChain = async (user:ActiveWallet, jetton:ActiveJettonWallet,
                                      expected_voted:bigint,
                                      expected_not_voted: bigint,
                                      voting:Address, 
                                      expiration_date:bigint, 
                                      vote_for:boolean,
                                      confirm_vote:boolean) => {
    const keeperAddress = await jetton.getVoteKeeperAddress(voting);
    const res = await jetton.sendVote(user.getSender(), voting, expiration_date, vote_for, confirm_vote);

    expect(res.transactions).toHaveTransaction({
        from: user.address,
        to: jetton.address,
        body: JettonWallet.voteMessage(voting,
                                       expiration_date,
                                       vote_for, confirm_vote),
        success: true
                                       
    });
    expect(res.transactions).toHaveTransaction({
        from: jetton.address,
        to: keeperAddress,
        body: VoteKeeperTests.requestVoteMessage(user.address,
                                                 expiration_date,
                                                 expected_not_voted + expected_voted,
                                                 vote_for, confirm_vote),
        success: true
    });
    expect(res.transactions).toHaveTransaction({
        from: keeperAddress,
        to: voting,
        body: VotingTests.submitVotesMessage(user.address,
                                             expiration_date,
                                             expected_not_voted,
                                             vote_for, confirm_vote),
        success: true
    });

    const confirmMsg = {
        from: jetton.address,
        to: user.address,
        body: beginCell().storeUint(0x5fe9b8ca, 32).storeUint(0, 64).endCell(),
        success: true
    };

    const notifyMsg = {
        from: voting,
        to: user.address,
        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell(),
        success: true
    };

    if(confirm_vote) {
        expect(res.transactions).toHaveTransaction(confirmMsg);
        expect(res.transactions).not.toHaveTransaction(notifyMsg);
    }
    else {
        expect(res.transactions).toHaveTransaction(notifyMsg);
        expect(res.transactions).not.toHaveTransaction(confirmMsg);
    }

    return res;
}
