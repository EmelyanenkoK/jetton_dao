import { Address, toNano } from 'ton-core';
import { JettonMinter, JettonMinterContent, jettonContentToCell, jettonMinterConfigToCell } from '../wrappers/JettonMinter';
import { compile, NetworkProvider, UIProvider} from '@ton-community/blueprint';
import { promptAddress, promptBool, promptUrl } from '../wrappers/ui-utils';

const formatUrl = "https://github.com/ton-blockchain/TEPs/blob/master/text/0064-token-data-standard.md#nft-collection-metadata-example-offchain";
const exampleContent = {
   image: "https://s.getgems.io/nft/b/c/62fba50217c3fe3cbaad9e7f/image.png",
   name: "TON Smart Challenge #2",
   description: "TON Smart Challenge #2 Winners Trophy",
   social_links: [],
   marketplace: "getgems.io"
};
const urlPrompt = 'Please specify url pointing to jetton metadata(json):';

export async function run(provider: NetworkProvider) {
    const ui       = provider.ui();
    const sender   = provider.sender();
    if(sender.address === undefined)
        throw("Can't get sender address");
    const adminPrompt = `Please specify admin address(${sender.address} as default)`;
    ui.write(`Jetton deployer\nCurrent deployer onli supports off-chain format:${formatUrl}`);

    let admin      = await promptAddress(adminPrompt, ui, sender.address);
    ui.write(`Admin address:${admin}\n`);
    let contentUrl = await promptUrl(urlPrompt, ui);
    ui.write(`Jetton content url:${contentUrl}`);

    let dataCorrect = false;
    do {
        ui.write("Please verify data:\n")
        ui.write(`Admin:${admin}\n\n`);
        ui.write('Metadata url:' + contentUrl);
        dataCorrect = await promptBool('Is everything ok?(y/n)', ['y','n'], ui);
        if(!dataCorrect) {
            const upd = await ui.choose('What do you want to update?', ['Admin', 'Url'], (c) => c);

            if(upd == 'Admin') {
                admin = await promptAddress(adminPrompt, ui, sender.address);
            }
            else {
                contentUrl = await promptUrl(urlPrompt, ui);
            }
        }

    } while(!dataCorrect);

    const content = jettonContentToCell({type:1,uri:contentUrl});

    const wallet_code = await compile('JettonWallet');
    const voting_code = await compile('Voting');
    const vote_keeper_code = await compile('VoteKeeper');

    const minter  = JettonMinter.createFromConfig({admin,
                                                  content,
                                                  wallet_code,
                                                  voting_code,
                                                  vote_keeper_code}, 
                                                  await compile('JettonMinter'));

    await provider.deploy(minter, toNano('0.05'));
}
