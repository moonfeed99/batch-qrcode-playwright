const { chromium } = require('playwright');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ========== 核心配置（你只需要改这里！） ==========
const CONFIG = {
  pageUrl: 'http://localhost:5173',       // 你的二维码生成页面地址
  excelPath: path.resolve(__dirname, 'data.xlsx'), // Excel文件路径
  saveDir: path.resolve(__dirname, 'qrcode_screenshots'), // 截图保存文件夹
  serialStart: 1,            // 全局起始流水号（所有截图连续编号）
  serialLen: 3,             // 流水号位数（3=001，4=0001）
  headless: false,          // false=可视化运行，true=后台静默运行
  slowMo: 300,               // 操作延迟（避免页面没加载完）
  timeout: 20000            // 等待超时时间
};

// 自动创建截图文件夹
if (!fs.existsSync(CONFIG.saveDir)) fs.mkdirSync(CONFIG.saveDir);

// ========== 工具函数 ==========
/**
 * 读取Excel：物料号(A列)、图号(B列)、个数(C列)
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
    const description = row[2]?.toString().trim(); // 描述
    const count = parseInt(row[3]) || 0;            // 个数
    
    if (materialCode && drawingCode && description && count > 0) {
      data.push({ materialCode, drawingCode, description,count });
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
    // 序号补零（01、02...）
    const serial = String(i).padStart(2, '0');
    // 编码格式：物料号 图号 日期+序号
    const line = `${materialCode} ${drawingCode} ${dateStr}${serial}`;
    contentList.push(line);
  }
  
  // 用换行符拼接所有内容（适配输入框多行输入）
  return contentList.join('\n');
}

// ========== 主逻辑：批量生成+分页截图 ==========
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

  // 全局流水号（所有截图连续递增）
  let globalSerial = CONFIG.serialStart;

  // 3. 循环处理每个物料
  for (const task of taskList) {
    const { materialCode, drawingCode,description, count } = task;
    console.log(`\n====================================`);
    console.log(`处理物料：${materialCode} | 图号：${drawingCode} | 描述：${description} | 个数：${count}`);

    try {
      // 生成二维码多行内容
      const qrContent = generateQrContent(materialCode, drawingCode, count);
      
      // 清空输入框 → 填入内容 → 点击生成按钮
      const inputBox = page.getByRole('textbox'); // 输入框选择器（通用适配）
      await inputBox.fill('');
      await inputBox.fill(qrContent);
      await page.getByRole('button', { name: '生成二维码' }).click(); // 生成按钮
      await page.waitForSelector('#printArea', { timeout: CONFIG.timeout }); // 等待二维码区域加载
      await page.waitForTimeout(800);

      // ========== 核心：分页循环截图 ==========
      let hasNextPage = true;
      while (hasNextPage) {
        // 1. 生成当前截图文件名
        const serialStr = getSerial(globalSerial);
        const screenshotPath = path.join(CONFIG.saveDir, `${serialStr}.png`);

        // 2. 截图（精准截取二维码区域）
        await page.locator('#printArea').scrollIntoViewIfNeeded();
        await page.locator('#printArea').screenshot({ path: screenshotPath });
        console.log(`✅ 截图保存：${serialStr}.png`);

        // 3. 流水号+1
        globalSerial++;

        // 4. 查找下一页按钮
        const nextPageBtn = page.getByRole('button', { name: '下一页' });
        const isDisabled = await nextPageBtn.evaluate(btn => btn.disabled || !btn.offsetParent);
        const isHidden = await nextPageBtn.isHidden().catch(() => true);

        if (isDisabled || isHidden) {
          hasNextPage = false;
          console.log('📄 已到最后一页，切换下一个物料');
        } else {
          // 点击下一页，等待加载
          await nextPageBtn.click();
          await page.waitForTimeout(800);
        }
      }

    } catch (err) {
      console.error(`❌ 物料 ${materialCode} 处理失败：`, err.message);
      continue;
    }
  }

  // 4. 结束任务
  await browser.close();
  console.log(`\n🎉 全部任务完成！共生成 ${globalSerial - CONFIG.serialStart} 张截图`);
}

run();
