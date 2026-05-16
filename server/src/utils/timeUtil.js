const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')
require('dayjs/locale/zh-cn')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)
dayjs.locale('zh-cn')

const TZ = process.env.SCHEDULE_TZ || 'Asia/Shanghai'

function nowLocal() {
  return dayjs().tz(TZ)
}

function fmt(d, pattern = 'YYYY/MM/DD HH:mm') {
  return dayjs(d).tz(TZ).format(pattern)
}

module.exports = { dayjs, TZ, nowLocal, fmt }
