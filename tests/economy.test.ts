import test from "node:test";
import assert from "node:assert/strict";
import { parseWorldBankSeries, economyChartPoints } from "../src/lib/economy.ts";

test("only dated finite World Bank observations are accepted",()=>{
 const input=[{page:1,pages:1},[
  {date:"2025",value:2.16},{date:"2024",value:2.79},
  {date:"2023",value:null},{date:"2022",value:"8"},
  {date:"invalid",value:1},{date:"2021",value:Infinity},
 ]];
 const result=parseWorldBankSeries(input,"NY.GDP.MKTP.KD.ZG");
 assert.equal(result?.latestYear,2025);
 assert.equal(result?.observations.length,2);
 assert.equal(result?.observations[0].year,2024);
 assert.equal(result?.label,"Real GDP growth");
});
test("reject unsupported indicators and incomplete annual evidence",()=>{
 assert.equal(parseWorldBankSeries([{},[{date:"2025",value:2},{date:"2024",value:1}]],"unknown"),null);
 assert.equal(parseWorldBankSeries([{},[{date:"2025",value:2}]],"NY.GDP.MKTP.KD.ZG"),null);
 assert.equal(parseWorldBankSeries({}, "NY.GDP.MKTP.KD.ZG"),null);
});
test("growth chart handles negative years and finite points",()=>{
 const plot=economyChartPoints([{year:2020,value:-3},{year:2021,value:6},{year:2022,value:2}]);
 assert.equal(plot.split(" ").length,3);
 assert.ok(plot.startsWith("6.0,"));
 assert.equal(economyChartPoints([{year:2025,value:2}]),"");
});
