import { ethers } from 'hardhat';
import OnchainID from '@onchain-id/solidity';

/**
 * 將新用戶加入白名單並 mint tokens
 * 步驟：
 * 1. 創建用戶的 OnchainID
 * 2. 註冊到 IdentityRegistry（白名單）
 * 3. 添加 KYC Claim
 * 4. Mint 100 tokens
 */

async function main() {
  console.log('\n========================================');
  console.log('添加新用戶到白名單並 mint tokens');
  console.log('========================================\n');

  // ==================== 配置 ====================
  const DEPLOYED_ADDRESSES = {
    token: '0xBEae6Fa62362aB593B498692FD09002a9eEd52dc',
    identityRegistry: '0xF2a0227754b62AD3719780F79BA034c871c873f0',
    identityImplementationAuthority: '0x187eDAc6D0C7E9f7162FD469F5dDAD000910c9D4',
    claimIssuerContract: '0x6cb335F1Bb7CEA9FD0e1cfC44C816A444717166b',
    claimTopics: ['0x2e8e9dbac879b1e3204f60b5b07c03c463be5f75a01ec30831bc754da79e4bf5'],
    claimIssuerSigningPrivateKey: '0xa052bad8355b9c6ebe5c810d388565b207b97efe9bcba54170143772a8bd85e6',
  };

  // ==================== 新用戶資訊 ====================
  // 選項 1: 使用現有錢包地址
  const NEW_USER_ADDRESS = '0x287186c8e5624cc9943aA58728358ADAF24EABD7';  // 填入新用戶的錢包地址

  // 選項 2: 或者生成新的測試錢包
  // const newUser = ethers.Wallet.createRandom().connect(ethers.provider);
  // const NEW_USER_ADDRESS = newUser.address;

  const MINT_AMOUNT = 100;  // 要 mint 的數量

  // ==================== 連接合約 ====================
  const [deployer] = await ethers.getSigners();

  console.log('Deployer (Token Agent):', deployer.address);
  console.log('New User Address:', NEW_USER_ADDRESS);
  console.log('Mint Amount:', MINT_AMOUNT);
  console.log('');

  const token = await ethers.getContractAt('Token', DEPLOYED_ADDRESSES.token);
  const identityRegistry = await ethers.getContractAt('IdentityRegistry', DEPLOYED_ADDRESSES.identityRegistry);
  const claimIssuerContract = await ethers.getContractAt('ClaimIssuer', DEPLOYED_ADDRESSES.claimIssuerContract);
  const claimIssuerSigningKey = new ethers.Wallet(DEPLOYED_ADDRESSES.claimIssuerSigningPrivateKey);

  // ==================== 步驟 1: 檢查用戶是否已註冊 ====================
  console.log('【步驟 1/5】檢查用戶是否已註冊...\n');

  const existingIdentity = await identityRegistry.identity(NEW_USER_ADDRESS);

  if (existingIdentity !== ethers.constants.AddressZero) {
    console.log('⚠️  用戶已有 Identity:', existingIdentity);
    console.log('使用現有 Identity\n');

    const userIdentity = await ethers.getContractAt('Identity', existingIdentity);

    // 檢查驗證狀態
    const isVerified = await identityRegistry.isVerified(NEW_USER_ADDRESS);
    console.log('當前驗證狀態:', isVerified);

    if (!isVerified) {
      console.log('\n⚠️  用戶未驗證，需要添加 KYC Claim');
      console.log('注意：此 Identity 的 management key 可能不是 deployer');
      console.log('如果添加 Claim 失敗，請用戶自己添加，或重新創建新的 Identity\n');

      // 嘗試添加 Claim
      try {
        await addKYCClaim(userIdentity);
      } catch (error: any) {
        console.error('\n❌ 無法添加 Claim（權限不足）');
        console.error('錯誤:', error.message);
        console.log('\n解決方案：');
        console.log('1. 請用戶自己添加 Claim，或');
        console.log('2. 先從 IdentityRegistry 刪除此用戶，然後重新運行腳本創建新 Identity\n');
        return;
      }
    }

    // 跳到 mint
    await mintTokens(userIdentity);
    return;
  }

  console.log('✓ 用戶尚未註冊，開始創建 Identity');

  // ==================== 步驟 2: 創建 OnchainID ====================
  console.log('\n【步驟 2/5】創建用戶的 OnchainID...\n');

  // 使用 deployer 作為 management key，與 deploy-sepolia-erc3643.ts 相同
  // 這樣 deployer 才能在步驟 4 添加 Claim
  const userIdentityProxy = await new ethers.ContractFactory(
    OnchainID.contracts.IdentityProxy.abi,
    OnchainID.contracts.IdentityProxy.bytecode,
    deployer
  ).deploy(DEPLOYED_ADDRESSES.identityImplementationAuthority, deployer.address);
  await userIdentityProxy.deployed();

  const userIdentity = await ethers.getContractAt('Identity', userIdentityProxy.address);
  console.log('✓ Identity 已創建:', userIdentity.address);

  // ==================== 步驟 3: 註冊到 IdentityRegistry（加入白名單）====================
  console.log('\n【步驟 3/5】註冊到 IdentityRegistry（加入白名單）...\n');

  await (
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        NEW_USER_ADDRESS,
        userIdentity.address,
        840  // 國家代碼：840 = USA（可修改）
      )
  ).wait();
  console.log('✓ 用戶已註冊 (Country: 840 - USA)');
  console.log('✓ 已加入白名單！');

  // ==================== 步驟 4: 添加 KYC Claim ====================
  await addKYCClaim(userIdentity);

  // ==================== 步驟 5: Mint Tokens ====================
  await mintTokens(userIdentity);

  // ==================== 內部函數：添加 KYC Claim ====================
  async function addKYCClaim(identity: any) {
    console.log('\n【步驟 4/5】為用戶添加 KYC Claim...\n');

    const claimForUser = {
      data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('User KYC verified')),
      issuer: claimIssuerContract.address,
      topic: DEPLOYED_ADDRESSES.claimTopics[0],
      scheme: 1,
      identity: identity.address,
      signature: '',
    };

    // 簽署 Claim
    claimForUser.signature = await claimIssuerSigningKey.signMessage(
      ethers.utils.arrayify(
        ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'bytes'],
            [claimForUser.identity, claimForUser.topic, claimForUser.data]
          )
        )
      )
    );

    // 添加 Claim（需要用戶自己操作，但這裡由 deployer 代為操作）
    // ⚠️ 注意：在生產環境中，應該由用戶自己添加 Claim
    await (
      await identity
        .connect(deployer)  // deployer 是 management key
        .addClaim(
          claimForUser.topic,
          claimForUser.scheme,
          claimForUser.issuer,
          claimForUser.signature,
          claimForUser.data,
          ''
        )
    ).wait();
    console.log('✓ KYC Claim 已添加');

    // 驗證用戶
    const isVerified = await identityRegistry.isVerified(NEW_USER_ADDRESS);
    console.log('✓ 用戶驗證狀態:', isVerified);

    if (!isVerified) {
      throw new Error('用戶驗證失敗，無法 mint tokens');
    }
  }

  // ==================== 內部函數：Mint Tokens ====================
  async function mintTokens(identity: any) {
    console.log('\n【步驟 5/5】Mint tokens 給用戶...\n');

    const balanceBefore = await token.balanceOf(NEW_USER_ADDRESS);
    console.log('Mint 前餘額:', balanceBefore.toString());

    await (await token.connect(deployer).mint(NEW_USER_ADDRESS, MINT_AMOUNT)).wait();
    console.log(`✓ Minted ${MINT_AMOUNT} tokens 給用戶`);

    const balanceAfter = await token.balanceOf(NEW_USER_ADDRESS);
    console.log('Mint 後餘額:', balanceAfter.toString());

    // ==================== 完成 ====================
    console.log('\n========================================');
    console.log('🎉 完成！');
    console.log('========================================\n');

    console.log('用戶資訊：');
    console.log('  地址:', NEW_USER_ADDRESS);
    console.log('  Identity:', identity.address);
    console.log('  Token 餘額:', balanceAfter.toString());
    console.log('  驗證狀態: ✅');
    console.log('\n用戶現在可以接收和轉帳 tokens！\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ 失敗:');
    console.error(error);
    process.exit(1);
  });
