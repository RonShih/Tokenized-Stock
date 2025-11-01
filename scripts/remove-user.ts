import { ethers } from 'hardhat';

/**
 * 從 IdentityRegistry 刪除用戶
 * 這會移除用戶的白名單資格和 Identity 綁定
 */

async function main() {
  console.log('\n========================================');
  console.log('從 IdentityRegistry 刪除用戶');
  console.log('========================================\n');

  // ==================== 配置 ====================
  const DEPLOYED_ADDRESSES = {
    identityRegistry: '0xF2a0227754b62AD3719780F79BA034c871c873f0',
  };

  // ==================== 要刪除的用戶地址 ====================
  const USER_TO_REMOVE = '0x3036BE19443A894dE4502D8A33a3b03ae3d61bCc';

  // ==================== 連接合約 ====================
  const [deployer] = await ethers.getSigners();

  console.log('Deployer:', deployer.address);
  console.log('要刪除的用戶:', USER_TO_REMOVE);
  console.log('');

  const identityRegistry = await ethers.getContractAt(
    'IdentityRegistry',
    DEPLOYED_ADDRESSES.identityRegistry
  );

  // ==================== 檢查用戶狀態 ====================
  console.log('【步驟 1/2】檢查用戶當前狀態...\n');

  const existingIdentity = await identityRegistry.identity(USER_TO_REMOVE);

  if (existingIdentity === ethers.constants.AddressZero) {
    console.log('⚠️  用戶未註冊，無需刪除');
    return;
  }

  console.log('✓ 用戶已註冊');
  console.log('  Identity 地址:', existingIdentity);

  const isVerified = await identityRegistry.isVerified(USER_TO_REMOVE);
  console.log('  驗證狀態:', isVerified ? '✅ 已驗證' : '❌ 未驗證');

  const country = await identityRegistry.investorCountry(USER_TO_REMOVE);
  console.log('  國家代碼:', country);

  // ==================== 刪除用戶 ====================
  console.log('\n【步驟 2/2】從 IdentityRegistry 刪除用戶...\n');

  await (await identityRegistry.connect(deployer).deleteIdentity(USER_TO_REMOVE)).wait();

  console.log('✓ 用戶已從 IdentityRegistry 刪除');

  // ==================== 驗證刪除結果 ====================
  const identityAfter = await identityRegistry.identity(USER_TO_REMOVE);
  const isVerifiedAfter = await identityRegistry.isVerified(USER_TO_REMOVE);

  console.log('\n刪除後狀態：');
  console.log('  Identity 地址:', identityAfter);
  console.log('  驗證狀態:', isVerifiedAfter ? '✅ 已驗證' : '❌ 未驗證');

  // ==================== 完成 ====================
  console.log('\n========================================');
  console.log('🎉 完成！');
  console.log('========================================\n');

  console.log('用戶已從白名單移除');
  console.log('注意：用戶的 OnchainID (Identity) 仍然存在於鏈上');
  console.log('      地址:', existingIdentity);
  console.log('      只是不再與 IdentityRegistry 綁定\n');

  console.log('現在可以重新運行 add-user-and-mint.ts 來創建新的 Identity\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ 失敗:');
    console.error(error);
    process.exit(1);
  });
