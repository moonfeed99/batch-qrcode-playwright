console.log('hello,world');

import { chromium } from 'playwright'
// const {chromium} = require('playwright')

(async ()=>{
    const browser = await chromium.launch({headless:false});
    const page = await browser.newPage();

    await page.goto('https://cyqmskj.xcmg.com');

    // login
    const username = await page.locator('#username');
    console.log(username)
    // await page.locator('#password').fill('Chuandong@123')
    // await page.locator('#submitBtn').click()
    
    // // supplier management
    // await page.locator('#menuCodeppeg').click()

    // // '质量信息'
    // await page.getByTitle(/^质量信息$/).click()
    // // '一次交验质量信息'
    // await page.getByText('一次交验质量信息').click();

    // const shotName = 'tms.png'

    // await page.screenshot({path:shotName})

    await browser.close()

})()