export const SLA_HOURS_BY_PRIORITY = {
  P1: 3,
  P2: 6,
  P3: 9,
  P4: 12,
} as const

const WORK_START_HOUR = 10
const WORK_END_HOUR = 18

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function isNonWorkingDay(date: Date, holidayDates: Set<string>): boolean {
  const dayOfWeek = date.getDay()
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const isHoliday = holidayDates.has(getLocalDateKey(date))

  return isWeekend || isHoliday
}

export function addBusinessHours(
  startAt: Date | string,
  hoursToAdd: number,
  holidayDateList: string[] = []
): Date {
  const cursor = new Date(startAt)

  if (Number.isNaN(cursor.getTime())) {
    throw new Error('The ticket start date is invalid.')
  }

  if (hoursToAdd < 0) {
    throw new Error('SLA hours cannot be negative.')
  }

  const holidayDates = new Set(holidayDateList)
  let remainingMilliseconds = hoursToAdd * 60 * 60 * 1000

  while (remainingMilliseconds > 0) {
    if (isNonWorkingDay(cursor, holidayDates)) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(WORK_START_HOUR, 0, 0, 0)
      continue
    }

    const workdayStart = new Date(cursor)
    workdayStart.setHours(WORK_START_HOUR, 0, 0, 0)

    const workdayEnd = new Date(cursor)
    workdayEnd.setHours(WORK_END_HOUR, 0, 0, 0)

    if (cursor < workdayStart) {
      cursor.setTime(workdayStart.getTime())
    }

    if (cursor >= workdayEnd) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(WORK_START_HOUR, 0, 0, 0)
      continue
    }

    const availableMilliseconds = workdayEnd.getTime() - cursor.getTime()
    const usedMilliseconds = Math.min(
      availableMilliseconds,
      remainingMilliseconds
    )

    cursor.setTime(cursor.getTime() + usedMilliseconds)
    remainingMilliseconds -= usedMilliseconds

    if (remainingMilliseconds > 0) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(WORK_START_HOUR, 0, 0, 0)
    }
  }

  return cursor
}

export function formatDateTime(value: Date | string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hour = date.getHours()
  const hour12 = hour % 12 || 12
  const minute = String(date.getMinutes()).padStart(2, '0')
  const period = hour >= 12 ? 'PM' : 'AM'

  return `${day}/${month}/${year}, ${hour12}:${minute} ${period}`
}

export function getBusinessHoursBetween(
  startAt: Date,
  endAt: Date,
  holidayDateList: string[],
) {
  if (endAt <= startAt) return 0

  const holidays = new Set(holidayDateList)
  let totalMilliseconds = 0

  const day = new Date(
    startAt.getFullYear(),
    startAt.getMonth(),
    startAt.getDate(),
  )

  while (day.getTime() <= endAt.getTime()) {
    const dayOfWeek = day.getDay()
    const dateKey = [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0'),
    ].join('-')

    const isWeekday = dayOfWeek !== 0 && dayOfWeek !== 6

    if (isWeekday && !holidays.has(dateKey)) {
      const workStart = new Date(day)
      workStart.setHours(10, 0, 0, 0)

      const workEnd = new Date(day)
      workEnd.setHours(18, 0, 0, 0)

      const overlapStart = Math.max(startAt.getTime(), workStart.getTime())
      const overlapEnd = Math.min(endAt.getTime(), workEnd.getTime())

      if (overlapEnd > overlapStart) {
        totalMilliseconds += overlapEnd - overlapStart
      }
    }

    day.setDate(day.getDate() + 1)
  }

  return totalMilliseconds / (60 * 60 * 1000)
}