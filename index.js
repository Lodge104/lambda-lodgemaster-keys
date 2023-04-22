import * as dotenv from 'dotenv'
dotenv.config()
import puppeteer from 'puppeteer';

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
// Set the AWS Region.
const REGION = "us-east-1"; //e.g. "us-east-1"
// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: REGION });

import { BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";

(async () => {
    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();
  
    await page.goto('https://lodgemaster-client.oa-bsa.org/');
  
    // Set screen size
    await page.setViewport({width: 1080, height: 1024});
  
    // Type into username box
    await page.type('#Username', process.env.USERNAME);

    // Type into password box
    await page.type('#Password', process.env.PASSWORD);
  
    // Wait and click on submit
    const submitSelector = 'button.btn.btn-secondary.btn-lg';
    await page.waitForSelector(submitSelector);
    await page.click(submitSelector);

    await page.waitForNetworkIdle({idleTime: 5000});

    const cookiesSet = await page.cookies();

    const p = JSON.parse(JSON.stringify(cookiesSet))

    // Set the parameters
    const params = {
      RequestItems: {
        "lodge104-keys": [
          {
            PutRequest: {
              Item: {
                name: { S: p[0]['name'] },
                value: { S: p[0]['value'] },
              },
            },
          },
          {
            PutRequest: {
              Item: {
                name: { S: p[1]['name'] },
                value: { S: p[1]['value'] },
              },
            },
          },
          {
            PutRequest: {
              Item: {
                name: { S: p[2]['name'] },
                value: { S: p[2]['value'] },
              },
            },
          },
          {
            PutRequest: {
              Item: {
                name: { S: p[3]['name'] },
                value: { S: p[3]['value'] },
              },
            },
          },
        ],
      },
    };

    const run = async () => {
      try {
        const data = await ddbClient.send(new BatchWriteItemCommand(params));
        console.log("Success, items inserted", data);
        return data;
      } catch (err) {
        console.log("Error", err);
      }
    };
    run();
    await browser.close();

  })();

