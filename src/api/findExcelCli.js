import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { DeviceCodeCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";

// 1. โหลดตัวแปรจากไฟล์ .env ที่ Root โฟลเดอร์
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { TENANT_ID, CLIENT_ID, TARGET_USER_EMAIL } = process.env;

if (!TENANT_ID || !CLIENT_ID) {
  console.error("❌ ข้อผิดพลาด: ไม่พบ TENANT_ID หรือ CLIENT_ID ในไฟล์ .env");
  process.exit(1);
}

// 2. รับชื่อไฟล์จาก Command Line Argument
const args = process.argv.slice(2);
const searchFileName = args.join(" ").trim();

if (!searchFileName) {
  console.log("\n⚠️  วิธีใช้งาน:");
  console.log('   node .\\src\\api\\findExcelCli.js "ชื่อไฟล์.xlsx"\n');
  console.log("ตัวอย่าง:");
  console.log('   node .\\src\\api\\findExcelCli.js "ข้อสอบ 2.xlsx"\n');
  process.exit(1);
}

// 3. สร้าง Credential แบบ Device Code Flow
const credential = new DeviceCodeCredential({
  tenantId: TENANT_ID,
  clientId: CLIENT_ID,
  userPromptCallback: (info) => {
    console.log("\n🔐 ==========================================");
    console.log("กรุณายืนยันตัวตนผ่านเบราว์เซอร์:");
    console.log(info.message);
    console.log("==========================================\n");
  },
});

const authProvider = new TokenCredentialAuthenticationProvider(credential, {
  scopes: ["https://graph.microsoft.com/Files.Read", "https://graph.microsoft.com/User.Read"],
});

const graphClient = Client.initWithMiddleware({ authProvider });

// 4. ฟังก์ชันค้นหาและดึงทั้ง DRIVE_ID และ FILE_ITEM_ID
async function findExcelDriveAndFileId(fileName) {
  console.log(`\n🔍 กำลังค้นหา Drive และไฟล์: "${fileName}"...`);

  try {
    // 4.1 ดึง Drive ID หลักของผู้ใช้
    const driveEndpoint = TARGET_USER_EMAIL
      ? `/users/${TARGET_USER_EMAIL}/drive`
      : `/me/drive`;

    const driveInfo = await graphClient.api(driveEndpoint).select("id,name,driveType").get();
    const driveId = driveInfo.id;

    // 4.2 ค้นหาไฟล์ Excel ภายใน Drive
    const encodedFileName = encodeURIComponent(fileName);
    const searchEndpoint = `${driveEndpoint}/root/search(q='${encodedFileName}')`;

    const response = await graphClient
      .api(searchEndpoint)
      .select("id,name,webUrl,size,lastModifiedDateTime,file,parentReference")
      .get();

    const items = response.value || [];

    if (items.length === 0) {
      console.log(`❌ ไม่พบไฟล์ที่ตรงกับคำค้นหา: "${fileName}" ใน Drive: ${driveId}\n`);
      return null;
    }

    // กรองหาไฟล์ที่ชื่อตรงกันแบบ 100% (Exact Match)
    const exactMatch = items.find(
      (item) => item.name.toLowerCase() === fileName.toLowerCase() && item.file
    );

    const targetFile = exactMatch || items[0];
    const fileDriveId = targetFile.parentReference?.driveId || driveId;

    console.log("\n==========================================");
    console.log("✅ พบข้อมูลสำเร็จ!");
    console.log("==========================================");
    console.log(`📄 File Name     : ${targetFile.name}`);
    console.log(`🆔 DRIVE_ID      : ${fileDriveId}`);
    console.log(`🆔 ITEM_ID       : ${targetFile.id}`);
    console.log(`📁 Size          : ${(targetFile.size / 1024).toFixed(2)} KB`);
    console.log(`🕒 Last Modified : ${new Date(targetFile.lastModifiedDateTime).toLocaleString("th-TH")}`);
    console.log(`🔗 Web URL       : ${targetFile.webUrl}`);
    console.log("==========================================");

    return {
      driveId: fileDriveId,
      itemId: targetFile.id,
      fileName: targetFile.name,
    };
  } catch (error) {
    console.error("\n❌ เกิดข้อผิดพลาดในการเรียก Microsoft Graph API:");
    console.error(error.message || error);
    return null;
  }
}

// 5. สั่งรันฟังก์ชัน
await findExcelDriveAndFileId(searchFileName);