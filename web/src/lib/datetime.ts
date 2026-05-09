import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/zh-tw';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.locale('zh-tw');

export const APP_TZ = 'Asia/Taipei';

export function inTz(d: dayjs.ConfigType) {
  return dayjs.utc(d).tz(APP_TZ);
}

export function fromNow(d: dayjs.ConfigType) {
  return inTz(d).fromNow();
}

export function formatLocal(d: dayjs.ConfigType, fmt = 'YYYY-MM-DD HH:mm') {
  return inTz(d).format(fmt);
}

export default dayjs;
