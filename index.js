import * as dotenv from 'dotenv'
dotenv.config()
import puppeteer from 'puppeteer';

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// a client can be shared by different commands.
const client = new S3Client({ region: "us-east-1" });

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

    const cookies = p[1]['name'] + "=" + p[1]['value'] + "; " + p[2]['name'] + "=" + p[2]['value'] + "; " + p[3]['name'] + "=" + p[3]['value'] + "; " + p[0]['name'] + "=" + p[0]['value'] + ";";

    var myHeaders = new Headers();
    myHeaders.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7");
    myHeaders.append("Origin", "https://lodgemaster-client.oa-bsa.org");
    myHeaders.append("Content-Type", "application/x-www-form-urlencoded");
    myHeaders.append("Cookie", cookies);
    
    var urlencoded = new URLSearchParams();
    urlencoded.append("exportFormat", "3");
    urlencoded.append("groupSeparateTabs", "true");
    urlencoded.append("exportAllColumns", "true");
    urlencoded.append("exportOalmId", "true");
    urlencoded.append("gridParams", "{\"$top\":100,\"$select\":\"Positions,EmailPrimaryBounced,AddressPrimaryBounced,PhonePrimaryBounced,BrotherhoodDate,BrotherhoodEligibleDate,BsaRegistrationActive,BsaPersonId,BsaLastCheckDate,Chapter,AddressPrimaryCity,DateOfBirth,EmailPrimaryAddress,FirstName,Gender,HealthMedicalDietaryRestrictions,HealthMedicalHasMedicalCondition,HealthMedicalHasMedicine,HealthMedicalOtherNotes,HealthMedicalHasOtherAllergies,HealthMedicalValidFromDate,LastName,PositionLec,Level,DuesYear,MiddleName,OrdealDate,PhonePrimaryNumber,AddressPrimaryState,AddressPrimaryStreet1,AddressPrimaryStreet2,Unit,UnitNumber,UnitType,VigilEligibleDate,VigilInductionDate,VigilNameEnglish,VigilNameTranslated,YouthProtectionCompliant,YouthProtectionDate,YouthAdult,AddressPrimaryZipCode,OalmId\",\"$filter\":\"(BsaPersonId ne null) and (DateOfDeath eq null) and (Level ne 'Non-Member')\",\"$count\":\"true\",\"duesIncludeYears\":\"2049,2048,2047,2046,2045,2044,2043,2042,2041,2040,2039,2038,2037,2036,2035,2034,2033,2032,2031,2030,2029,2028,2027,2026,2025,2024,2023,2022,2021,2020,2019,2018,2017,2016,2015,2014,2013,2012,2011,2010,2009,2008,2007,2006,2005,2004,2003,2002,2001,2000,1999,1998,1997,1993,1982,1981,1974\",\"duesIncludeNonPaid\":true}");
    urlencoded.append("columns", "[{\"id\":\"Positions\",\"index\":8},{\"id\":\"EmailPrimaryBounced\",\"index\":29},{\"id\":\"AddressPrimaryBounced\",\"index\":35},{\"id\":\"PhonePrimaryBounced\",\"index\":27},{\"id\":\"BrotherhoodDate\",\"index\":14},{\"id\":\"BrotherhoodEligibleDate\",\"index\":15},{\"id\":\"BsaRegistrationActive\",\"index\":1},{\"id\":\"BsaPersonId\",\"index\":0},{\"id\":\"BsaLastCheckDate\",\"index\":2},{\"id\":\"Chapter\",\"index\":10},{\"id\":\"AddressPrimaryCity\",\"index\":32},{\"id\":\"DateOfBirth\",\"index\":21},{\"id\":\"EmailPrimaryAddress\",\"index\":28},{\"id\":\"FirstName\",\"index\":5},{\"id\":\"Gender\",\"index\":23},{\"id\":\"HealthMedicalDietaryRestrictions\",\"index\":36},{\"id\":\"HealthMedicalHasMedicalCondition\",\"index\":37},{\"id\":\"HealthMedicalHasMedicine\",\"index\":38},{\"id\":\"HealthMedicalOtherNotes\",\"index\":40},{\"id\":\"HealthMedicalHasOtherAllergies\",\"index\":39},{\"id\":\"HealthMedicalValidFromDate\",\"index\":41},{\"id\":\"LastName\",\"index\":7},{\"id\":\"PositionLec\",\"index\":20},{\"id\":\"Level\",\"index\":12},{\"id\":\"DuesYear\",\"index\":9},{\"id\":\"MiddleName\",\"index\":6},{\"id\":\"OrdealDate\",\"index\":13},{\"id\":\"PhonePrimaryNumber\",\"index\":26},{\"id\":\"AddressPrimaryState\",\"index\":33},{\"id\":\"AddressPrimaryStreet1\",\"index\":30},{\"id\":\"AddressPrimaryStreet2\",\"index\":31},{\"id\":\"Unit\",\"index\":11},{\"id\":\"UnitNumber\",\"index\":25},{\"id\":\"UnitType\",\"index\":24},{\"id\":\"VigilEligibleDate\",\"index\":16},{\"id\":\"VigilInductionDate\",\"index\":17},{\"id\":\"VigilNameEnglish\",\"index\":18},{\"id\":\"VigilNameTranslated\",\"index\":19},{\"id\":\"YouthProtectionCompliant\",\"index\":3},{\"id\":\"YouthProtectionDate\",\"index\":4},{\"id\":\"YouthAdult\",\"index\":22},{\"id\":\"AddressPrimaryZipCode\",\"index\":34}]");

    var requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: urlencoded,
      redirect: 'follow'
    };
    
    fetch("https://lodgemaster-client.oa-bsa.org/api/members/grid/export", requestOptions)
      .then(response => response.text())
      .then(result => {
          const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: "memberdata.csv",
            Body: result,
          });
        
          try {
            const response = client.send(command);
            console.log(response);
          } catch (err) {
            console.error(err);
          }
      })
      .catch(error => console.log('error', error));
    await browser.close();

  })();

