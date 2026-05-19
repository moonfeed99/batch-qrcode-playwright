const { chromium } = require('playwright');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ========== 核心配置（你只需要改这里！） ==========
const CONFIG = {
  pageUrl: 'http://localhost:5173',       // 你的二维码页面地址
  excelPath: path.resolve(__dirname, 'data.xlsx'), // Excel文件路径
  saveDir: path.resolve(__dirname, 'qrcode_screenshots'), // 截图保存文件夹
  serialStart: 1,            // 全局起始流水号（所有截图连续编号）
  serialLen: 3,             // 流水号位数（3=001，4=0001）
  headless: false,          // false=可视化运行，true=后台静默运行
  slowMo: 300,               // 操作延迟（适配页面渲染速度）
  timeout: 20000            // 等待超时时间
};

// 自动创建截图文件夹
if (!fs.existsSync(CONFIG.saveDir)) fs.mkdirSync(CONFIG.saveDir);

// ========== 工具函数 ==========
/**
 * 读取Excel：A列物料号、B列图号、C列个数
 */
function readExcel() {
  const workbook = XLSX.readFile(CONFIG.excelPath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // 跳过表头，提取有效数据
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const materialCode = row[0]?.toString().trim(); // 物料号
    const drawingCode = row[1]?.toString().trim(); // 图号
    const description = row[2]?.toString().trim(); // 图号
    const count = parseInt(row[3]) || 0;            // 个数
    
    if (materialCode && drawingCode &&description && count > 0) {
      data.push({ materialCode, drawingCode,description, count });
    }
  }
  return data;
}

/**
 * 生成补零的流水号
 */
function getSerial(number) {
  return String(number).padStart(CONFIG.serialLen, '0');
}

/**
 * 获取当天日期（YYYYMMDD格式）
 */
function getTodayDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 生成二维码内容（换行分隔）
 */
function generateQrContent(materialCode, drawingCode, count) {
  const dateStr = getTodayDate();
  const contentList = [];
  
  // 循环个数，生成 1~count 行编码
  for (let i = 1; i <= count; i++) {
    const serial = String(i).padStart(2, '0');
    // 编码格式：物料号 图号 日期+序号
    const line = `${materialCode} ${drawingCode} ${dateStr}${serial}`;
    contentList.push(line);
  }
  
  // 换行拼接，适配输入框
  return contentList.join('\n');
}

// ========== 主逻辑：基于ID精准定位 ==========
async function run() {
  // 1. 读取Excel数据
  const taskList = readExcel();
  if (taskList.length === 0) {
    console.log('❌ Excel中无有效数据！');
    return;
  }
  console.log(`✅ 读取到 ${taskList.length} 个物料任务`);

  // 2. 启动浏览器
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    slowMo: CONFIG.slowMo
  });
  const page = await browser.newPage();
  await page.goto(CONFIG.pageUrl);
  await page.waitForLoadState('networkidle');

  // 全局流水号
  let globalSerial = CONFIG.serialStart;

  // 3. 循环处理每个物料
  for (const task of taskList) {
    const { materialCode, drawingCode,description, count } = task;
    console.log(`\n====================================`);
    console.log(`处理物料：${materialCode} | 图号：${drawingCode} | 个数：${count}`);

    try {
      // ==================== 核心：ID精准定位操作 ====================
      // 1. 清空并填写【物料名字输入框】ID: prtName
      await page.locator('#prtName').fill('');
      await page.locator('#prtName').fill(description); // 填入物料号

      // 2. 生成并填写【二维码内容输入框】ID: codeText
      const qrContent = generateQrContent(materialCode, drawingCode, count);
      await page.locator('#codeText').fill('');
      await page.locator('#codeText').fill(qrContent);

      // 3. 点击【生成二维码阵列】按钮 ID: generate
      await page.locator('#generate').click();
      await page.locator('#generate').click();
      
      // 4. 等待二维码区域加载完成 ID: printArea
      await page.locator('#printArea').waitFor({ state: 'visible', timeout: CONFIG.timeout });
      await page.waitForTimeout(800);

      // ==================== 分页循环截图 ====================
      let hasNextPage = true;
      while (hasNextPage) {
        // 生成截图文件名
        const serialStr = getSerial(globalSerial);
        const screenshotPath = path.join(CONFIG.saveDir, `${serialStr}.png`);

        // 截取二维码区域（ID: printArea 精准截图）
        await page.locator('#printArea').scrollIntoViewIfNeeded();
        await page.locator('#printArea').screenshot({ path: screenshotPath });
        console.log(`✅ 截图保存：${serialStr}.png`);

        // 流水号递增
        globalSerial++;

        // 判断并点击【下一页】按钮
        const nextPageBtn = page.getByRole('button', { name: '下一页' });
        const isHidden = await nextPageBtn.isHidden().catch(() => true);

        if (isHidden) {
          hasNextPage = false;
          console.log('📄 已到最后一页，切换下一个物料');
        } else {
          await nextPageBtn.click();
          await page.waitForTimeout(800);
        }
      }

    } catch (err) {
      console.error(`❌ 物料 ${materialCode} 处理失败：`, err.message);
      continue;
    }
  }

  // 4. 完成任务
  await browser.close();
  console.log(`\n🎉 全部任务完成！共生成 ${globalSerial - CONFIG.serialStart} 张截图`);
}

run();
