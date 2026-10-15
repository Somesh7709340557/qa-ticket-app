import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient'
import Auth, { PasswordRecovery } from './Auth'
import './App.css'
import {
  addBusinessHours,
  formatDateTime,
  getBusinessHoursBetween,
  SLA_HOURS_BY_PRIORITY,
} from './sla'

type Ticket = {
  id: string
  title: string
  priority: 'P1' | 'P2' | 'P3' | 'P4'
  status: 'Open' | 'In Progress' | 'On Hold' | 'Business Pending' | 'Resolved'
  scheme: string
  developer: string
  due: string
  assignedAt?: string
  slaDueAt?: string
  onHoldStartedAt?: string
  resolvedAt?: string
  reviewedSlaOverride?: 'Within SLA' | null
  reviewedSlaRemark?: string
  reviewedSlaAt?: string
  reviewedSlaBy?: string
}

type ImportTicketPayload = {
  id: string
  title: string
  priority: Ticket['priority']
  status: Ticket['status']
  scheme: string
  developer: string
  assigned_at: string
  sla_due_at: string
  resolved_at: string | null
  on_hold_started_at: string | null
}

type ImportPreviewRow = {
  rowNumber: number
  ticketId: string
  statusText: string
  assignedText: string
  resolvedText: string
  ticket: ImportTicketPayload | null
  duplicate: boolean
  errors: string[]
  warnings: string[]
}

type Holiday = {
  id: string
  holiday_date: string
  holiday_name: string
}

type Developer = {
  id: string
  name: string
}

type AssignedDateFilter =
  | 'all'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'currentQuarter'

type DashboardMetricKey =
  | 'assigned'
  | 'open'
  | 'resolved'
  | 'withinSla'
  | 'slaViolated'

type DashboardMetricPeriod = 'today' | 'overall'

type DashboardMetricSelection = {
  period: DashboardMetricPeriod
  key: DashboardMetricKey
} | null

type DashboardMetricCounts = Record<DashboardMetricKey, number>

const dashboardMetricDefinitions: {
  key: DashboardMetricKey
  label: string
}[] = [
  { key: 'assigned', label: 'Total assigned' },
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'withinSla', label: 'Within SLA' },
  { key: 'slaViolated', label: 'SLA violated' },
]

const assignedDateOptions: {
  value: AssignedDateFilter
  label: string
}[] = [
  { value: 'all', label: 'All dates' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'currentQuarter', label: 'Current quarter' },
]

const defaultTicketPageSize = 25

function getIndiaDateKey(value: string | undefined) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const dateParts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = dateParts.find((part) => part.type === 'year')?.value
  const month = dateParts.find((part) => part.type === 'month')?.value
  const day = dateParts.find((part) => part.type === 'day')?.value

  return year && month && day ? `${year}-${month}-${day}` : ''
}

function isAssignedDateInFilter(
  assignedAt: string | undefined,
  filter: AssignedDateFilter,
) {
  if (filter === 'all') return true
  if (!assignedAt) return false

  const assignedDate = new Date(assignedAt)
  if (Number.isNaN(assignedDate.getTime())) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const thisWeekStart = new Date(today)
  thisWeekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))

  let start: Date
  let end: Date

  if (filter === 'thisWeek') {
    start = thisWeekStart
    end = new Date(thisWeekStart)
    end.setDate(end.getDate() + 7)
  } else if (filter === 'lastWeek') {
    end = thisWeekStart
    start = new Date(thisWeekStart)
    start.setDate(start.getDate() - 7)
  } else if (filter === 'thisMonth') {
    start = new Date(today.getFullYear(), today.getMonth(), 1)
    end = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  } else if (filter === 'lastMonth') {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    end = new Date(today.getFullYear(), today.getMonth(), 1)
  } else {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3
    start = new Date(today.getFullYear(), quarterStartMonth, 1)
    end = new Date(today.getFullYear(), quarterStartMonth + 3, 1)
  }

  return assignedDate >= start && assignedDate < end
}

const schemeOptions = [
  'ECLGS',
  'CGFMU',
  'CGFEL',
  'FAS',
  'CGSSI',
  'CGSS',
  'CGFSD',
  'NWR - NPF',
  'CRGFTLIH',
  'LGSCAS',
  'MSME',
  'MFI',
  'LGSCATSS',
  'GSCD',
  'Common',
  'Other',
]

const developerOptions = [
  'Rahul giri',
  'Aniruddha Sharma',
  'Sachin',
  'Peeyush',
  'Pulkit',
  'Jatin',
  'Somesh',
  'Hina',
  'Ashish',
  'Asif',
]

const initialTickets: Ticket[] = [
  {
    id: 'QA-1042',
    title: 'Login page shows an error',
    priority: 'P1',
    status: 'In Progress',
    scheme: '',
    developer: '',
    due: '22 min',
  },
  {
    id: 'QA-1041',
    title: 'Update contact details',
    priority: 'P2',
    status: 'Open',
    scheme: '',
    developer: '',
    due: '2 hr',
  },
  {
    id: 'QA-1040',
    title: 'Payment receipt not received',
    priority: 'P2',
    status: 'On Hold',
    scheme: '',
    developer: '',
    due: 'Paused',
  },
  {
    id: 'QA-1039',
    title: 'Add family member to account',
    priority: 'P3',
    status: 'In Progress',
    scheme: '',
    developer: '',
    due: '1 day',
  },
]

function getLocalDateTimeInputValue() {
  const now = new Date()
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)

  return localTime.toISOString().slice(0, 16)
}

function toLocalDateTimeInputValue(value: string | undefined) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localTime.toISOString().slice(0, 16)
}

function parseIndiaTimestamp(value: unknown): string | null {
  const text = String(value ?? '').trim()
  const match = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/.exec(text)
  if (!match) return null

  const [, dayText, monthText, yearText, hourText, minuteText] = match
  const day = Number(dayText)
  const month = Number(monthText)
  const year = Number(yearText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(localAsUtc)

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null
  }

  // Workbook timestamps have no timezone; interpret them as India Standard Time.
  return new Date(localAsUtc - 330 * 60_000).toISOString()
}

function mapImportedStatus(value: string): Ticket['status'] | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'open') return 'Open'
  if (normalized === 'in progress') return 'In Progress'
  if (normalized === 'on hold') return 'On Hold'
  if (normalized === 'business pending' || normalized === 'awaiting business response') {
    return 'Business Pending'
  }
  if (normalized === 'resolved' || normalized === 'closed') return 'Resolved'
  return null
}

function App() {
  
  const [session, setSession] = useState<Session | null>(null)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const queryParams = new URLSearchParams(window.location.search)
    return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery'
  })
  const isTicketAdmin =
    session?.user.email?.toLowerCase() === 'ncgtc.support@infoneo.in'
  const [authLoading, setAuthLoading] = useState(true)

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [slaReviewTicket, setSlaReviewTicket] = useState<Ticket | null>(null)
  const [slaReviewSelection, setSlaReviewSelection] =
    useState<'SLA Violated' | 'Within SLA'>('SLA Violated')
  const [slaReviewRemark, setSlaReviewRemark] = useState('')
  const [isSavingSlaReview, setIsSavingSlaReview] = useState(false)
  const [ticketDetailsToast, setTicketDetailsToast] = useState<{
    title: string
    message: string
  } | null>(null)
  const [statusHistory, setStatusHistory] = useState<Record<string, string[]>>(
    {},
  )
  const [assignmentHistoryByTicket, setAssignmentHistoryByTicket] = useState<
    Record<string, string[]>
  >({})
  const [remarksByTicket, setRemarksByTicket] = useState<
    Record<string, string[]>
  >({})
  const [newRemark, setNewRemark] = useState('')

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [importError, setImportError] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [newTicketId, setNewTicketId] = useState('')
  const [newPriority, setNewPriority] = useState<Ticket['priority'] | ''>('')
  const [newScheme, setNewScheme] = useState('')
  const [newDeveloper, setNewDeveloper] = useState('')
  const [newAssignedAt, setNewAssignedAt] = useState(
    () => getLocalDateTimeInputValue(),
  )

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [schemeFilter, setSchemeFilter] = useState('All')
const [developerFilter, setDeveloperFilter] = useState('All')
const [assignedDateFilter, setAssignedDateFilter] =
  useState<AssignedDateFilter>('all')
  const [assignedDateFrom, setAssignedDateFrom] = useState('')
  const [assignedDateTo, setAssignedDateTo] = useState('')
  const [slaRiskFilter, setSlaRiskFilter] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [ticketPageSize, setTicketPageSize] = useState(defaultTicketPageSize)
  const [dashboardMetricSelection, setDashboardMetricSelection] =
    useState<DashboardMetricSelection>(null)
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([])
  const [holidayDates, setHolidayDates] = useState<string[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newHolidayDate, setNewHolidayDate] = useState('')
const [newHolidayName, setNewHolidayName] = useState('')
const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null)
  const [developers, setDevelopers] = useState<Developer[]>(
    developerOptions.map((name) => ({ id: `fallback:${name}`, name })),
  )
  const [developerListReady, setDeveloperListReady] = useState(false)
  const [developerDraft, setDeveloperDraft] = useState('')
  const [editingDeveloperId, setEditingDeveloperId] = useState<string | null>(null)
  const [resolutionTimeByTicket, setResolutionTimeByTicket] =
  useState<Record<string, string>>({})
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  useEffect(() => {
    setCurrentPage(1)
  }, [
    searchTerm,
    statusFilter,
    priorityFilter,
    schemeFilter,
    developerFilter,
    assignedDateFilter,
    assignedDateFrom,
    assignedDateTo,
    slaRiskFilter,
    dashboardMetricSelection?.period,
    dashboardMetricSelection?.key,
    ticketPageSize,
    tickets,
  ])

  useEffect(() => {
    if (!ticketDetailsToast) return

    const timeoutId = window.setTimeout(() => {
      setTicketDetailsToast(null)
    }, 6500)

    return () => window.clearTimeout(timeoutId)
  }, [ticketDetailsToast])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
      setSession(session)
      setAuthLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
  const intervalId = window.setInterval(() => {
    setCurrentTime(Date.now())
  }, 60_000)

  return () => window.clearInterval(intervalId)
}, [])

useEffect(() => {
  if (!session) return

  let cancelled = false

  async function loadResolutionTimes() {
    const { data: ticketRows, error: ticketError } = await supabase
      .from('tickets')
      .select('id, status, resolved_at')

    if (ticketError) {
      console.error('Could not load ticket resolution times:', ticketError.message)
      return
    }

    const { data: historyRows, error: historyError } = await supabase
      .from('ticket_status_history')
      .select('ticket_id, changed_at')
      .eq('to_status', 'Resolved')
      .order('changed_at', { ascending: false })

    if (historyError) {
      console.error('Could not load resolution history:', historyError.message)
      return
    }

    if (cancelled) return

    const latestHistoryByTicket: Record<string, string> = {}

    for (const row of historyRows ?? []) {
      if (!latestHistoryByTicket[row.ticket_id]) {
        latestHistoryByTicket[row.ticket_id] = row.changed_at
      }
    }

    const latestResolutionByTicket: Record<string, string> = {}
    for (const row of ticketRows ?? []) {
      if (row.status !== 'Resolved') continue
      const resolvedAt = row.resolved_at ?? latestHistoryByTicket[row.id]
      if (resolvedAt) latestResolutionByTicket[row.id] = resolvedAt
    }

    setResolutionTimeByTicket(latestResolutionByTicket)
  }

  void loadResolutionTimes()

  return () => {
    cancelled = true
  }
}, [session, tickets])

  useEffect(() => {
    if (!session) return

    let cancelled = false

    async function loadTickets() {
      const { data, error } = await supabase
        .from('tickets')
        .select(
  'id, title, priority, status, scheme, developer, assigned_at, created_at, sla_due_at, on_hold_started_at, resolved_at, reviewed_sla_override, reviewed_sla_remark, reviewed_sla_at, reviewed_sla_by',
)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Could not load tickets:', error.message)
        return
      }

      if (!cancelled && data) {
        setTickets(
          data.map((row) => ({
            id: row.id,
            title: row.title,
            priority: row.priority as Ticket['priority'],
            status: row.status as Ticket['status'],
            scheme: row.scheme,
            developer: row.developer,
            assignedAt: row.assigned_at ?? row.created_at,
            slaDueAt: row.sla_due_at ?? undefined,
            onHoldStartedAt: row.on_hold_started_at ?? undefined,
            resolvedAt: row.resolved_at ?? undefined,
            reviewedSlaOverride: row.reviewed_sla_override as Ticket['reviewedSlaOverride'],
            reviewedSlaRemark: row.reviewed_sla_remark ?? undefined,
            reviewedSlaAt: row.reviewed_sla_at ?? undefined,
            reviewedSlaBy: row.reviewed_sla_by ?? undefined,
            due:
  (row.status === 'On Hold' || row.status === 'Business Pending')
    ? 'Paused'
    : row.sla_due_at
      ? formatDateTime(row.sla_due_at)
      : '—',
          })),
        )
      }
    }

    void loadTickets()

    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (!selectedTicket) return

    const ticketId = selectedTicket.id
    let cancelled = false

    async function loadRemarks() {
      const { data, error } = await supabase
        .from('ticket_remarks')
        .select('remark, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Could not load remarks:', error.message)
        return
      }

      if (!cancelled) {
        setRemarksByTicket((currentRemarks) => ({
          ...currentRemarks,
          [ticketId]: (data ?? []).map(
            (row) => `${formatDateTime(row.created_at)} — ${row.remark}`,
          ),
        }))
      }
    }

    void loadRemarks()

    return () => {
      cancelled = true
    }
  }, [selectedTicket?.id])

  useEffect(() => {
    if (!selectedTicket) return

    const ticketId = selectedTicket.id
    let cancelled = false

    async function loadStatusHistory() {
      const { data, error } = await supabase
        .from('ticket_status_history')
        .select('from_status, to_status, changed_at')
        .eq('ticket_id', ticketId)
        .order('changed_at', { ascending: true })

      if (error) {
        console.error('Could not load status history:', error.message)
        return
      }

      if (!cancelled) {
        setStatusHistory((currentHistory) => ({
          ...currentHistory,
          [ticketId]: (data ?? []).map(
            (row) =>
              `${row.from_status} → ${row.to_status} · ${formatDateTime(row.changed_at)}`,
          ),
        }))
      }
    }

    void loadStatusHistory()

    return () => {
      cancelled = true
    }
  }, [selectedTicket?.id])

  useEffect(() => {
    if (!session) return

    let cancelled = false

    async function loadHolidayDates() {
      const { data, error } = await supabase
        .from('holidays')
        .select('id, holiday_date, holiday_name')
        .order('holiday_date', { ascending: true })

      if (error) {
        console.error('Could not load holiday dates:', error.message)
        return
      }

      if (!cancelled && data) {
        setHolidays(data)
setHolidayDates(data.map((row) => row.holiday_date))
      }
    }

    void loadHolidayDates()

    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (!session) return

    let cancelled = false

    async function loadDevelopers() {
      const { data, error } = await supabase
        .from('developers')
        .select('id, name')
        .order('name', { ascending: true })

      if (error) {
        console.error('Could not load the developer list:', error.message)
        return
      }

      if (!cancelled && data) {
        setDevelopers(data)
        setDeveloperListReady(true)
      }
    }

    void loadDevelopers()

    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (!selectedTicket) return

    const ticketId = selectedTicket.id
    let cancelled = false

    async function loadAssignmentHistory() {
      const { data, error } = await supabase
        .from('ticket_assignment_history')
        .select('developer, assigned_at')
        .eq('ticket_id', ticketId)
        .order('assigned_at', { ascending: true })

      if (error) {
        console.error('Could not load assignment history:', error.message)
        return
      }

      if (!cancelled) {
        setAssignmentHistoryByTicket((currentHistory) => ({
          ...currentHistory,
          [ticketId]: (data ?? []).map(
            (row) =>
              `Assigned to ${row.developer} · ${formatDateTime(row.assigned_at)}`,
          ),
        }))
      }
    }

    void loadAssignmentHistory()

    return () => {
      cancelled = true
    }
  }, [selectedTicket?.id])

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)

  function isAssignedToday(ticket: Ticket) {
    if (!ticket.assignedAt) return false
    const assignedAt = new Date(ticket.assignedAt).getTime()
    return assignedAt >= todayStart.getTime() && assignedAt < tomorrowStart.getTime()
  }

  function isWithinSla(ticket: Ticket) {
    if (!ticket.slaDueAt) return false
    const dueTime = new Date(ticket.slaDueAt).getTime()
    if (!Number.isFinite(dueTime)) return false

    if (ticket.status === 'Resolved') {
      const resolutionTime = resolutionTimeByTicket[ticket.id]
      return Boolean(resolutionTime && new Date(resolutionTime).getTime() <= dueTime)
    }

    if (ticket.status === 'On Hold' || ticket.status === 'Business Pending') return true
    return currentTime <= dueTime
  }

  function isSlaViolated(ticket: Ticket) {
    if (!ticket.slaDueAt) return false
    const dueTime = new Date(ticket.slaDueAt).getTime()
    if (!Number.isFinite(dueTime)) return false

    if (ticket.status === 'Resolved') {
      const resolutionTime = resolutionTimeByTicket[ticket.id]
      return Boolean(resolutionTime && new Date(resolutionTime).getTime() > dueTime)
    }

    if (ticket.status === 'On Hold' || ticket.status === 'Business Pending') return false
    return currentTime > dueTime
  }

  function isSlaAtRisk(ticket: Ticket) {
    if (
      !ticket.slaDueAt ||
      ticket.status === 'Resolved' ||
      ticket.status === 'On Hold' ||
      ticket.status === 'Business Pending'
    ) {
      return false
    }

    const dueTime = new Date(ticket.slaDueAt).getTime()
    const oneHourFromNow = currentTime + 60 * 60 * 1000
    return Number.isFinite(dueTime) && dueTime >= currentTime && dueTime <= oneHourFromNow
  }

  function getSlaStatusLabel(ticket: Ticket) {
    if (
      ticket.status === 'Resolved' &&
      !resolutionTimeByTicket[ticket.id]
    ) {
      return '—'
    }
    if (isSlaViolated(ticket)) return 'SLA Violated'
    if (isWithinSla(ticket)) return 'Within SLA'
    return '—'
  }

  function getReviewedSlaStatusLabel(ticket: Ticket) {
    return ticket.reviewedSlaOverride ?? getSlaStatusLabel(ticket)
  }

  function matchesMetric(ticket: Ticket, key: DashboardMetricKey) {
    if (key === 'assigned') return true
    if (key === 'open') return ticket.status !== 'Resolved'
    if (key === 'resolved') return ticket.status === 'Resolved'
    if (key === 'withinSla') return isWithinSla(ticket)
    return isSlaViolated(ticket)
  }

  function getMetricCounts(dataset: Ticket[]): DashboardMetricCounts {
    return {
      assigned: dataset.length,
      open: dataset.filter((ticket) => ticket.status !== 'Resolved').length,
      resolved: dataset.filter((ticket) => ticket.status === 'Resolved').length,
      withinSla: dataset.filter(isWithinSla).length,
      slaViolated: dataset.filter(isSlaViolated).length,
    }
  }

  const todayTickets = tickets.filter(isAssignedToday)
  const overallTickets = tickets.filter((ticket) =>
    isAssignedDateInFilter(ticket.assignedAt, assignedDateFilter),
  )
  const todayMetricCounts = getMetricCounts(todayTickets)
  const overallMetricCounts = getMetricCounts(overallTickets)
  const slaAtRiskCount = tickets.filter(isSlaAtRisk).length
  const hasCustomAssignedDateRange = Boolean(assignedDateFrom || assignedDateTo)
  const assignedDateRangeInvalid = Boolean(
    assignedDateFrom && assignedDateTo && assignedDateFrom > assignedDateTo,
  )

  const filteredTickets = tickets.filter((ticket) => {
    const search = searchTerm.toLowerCase()
    const matchesSearch =
      ticket.id.toLowerCase().includes(search) ||
      ticket.title.toLowerCase().includes(search) ||
      ticket.scheme.toLowerCase().includes(search) ||
      ticket.developer.toLowerCase().includes(search) ||
      ticket.priority.toLowerCase().includes(search) ||
      ticket.status.toLowerCase().includes(search)
    const matchesStatus = statusFilter === 'All' || ticket.status === statusFilter
    const matchesPriority = priorityFilter === 'All' || ticket.priority === priorityFilter
    const matchesScheme = schemeFilter === 'All' || ticket.scheme === schemeFilter
    const matchesDeveloper = developerFilter === 'All' || ticket.developer === developerFilter
    const assignedDateKey = getIndiaDateKey(ticket.assignedAt)
    const matchesCustomAssignedDateRange =
      !assignedDateRangeInvalid &&
      (!assignedDateFrom || (assignedDateKey !== '' && assignedDateKey >= assignedDateFrom)) &&
      (!assignedDateTo || (assignedDateKey !== '' && assignedDateKey <= assignedDateTo))
    const matchesAssignedDate = hasCustomAssignedDateRange
      ? matchesCustomAssignedDateRange
      : dashboardMetricSelection?.period === 'today'
        ? isAssignedToday(ticket)
        : isAssignedDateInFilter(ticket.assignedAt, assignedDateFilter)
    const matchesSelectedMetric =
      !dashboardMetricSelection || matchesMetric(ticket, dashboardMetricSelection.key)
    const matchesSlaRisk = !slaRiskFilter || isSlaAtRisk(ticket)

    return matchesSearch && matchesStatus && matchesPriority &&
      matchesScheme && matchesDeveloper && matchesAssignedDate &&
      matchesSelectedMetric && matchesSlaRisk
  })

  const totalTicketPages = Math.max(1, Math.ceil(filteredTickets.length / ticketPageSize))
  const visiblePage = Math.min(currentPage, totalTicketPages)
  const firstVisibleTicket = filteredTickets.length === 0
    ? 0
    : (visiblePage - 1) * ticketPageSize + 1
  const lastVisibleTicket = Math.min(visiblePage * ticketPageSize, filteredTickets.length)
  const paginatedTickets = filteredTickets.slice(
    (visiblePage - 1) * ticketPageSize,
    visiblePage * ticketPageSize,
  )

  const availableSchemeOptions = Array.from(
    new Set([...schemeOptions, ...tickets.map((ticket) => ticket.scheme)].filter(Boolean)),
  )
  const availableDeveloperOptions = Array.from(
    new Set([
      ...developers.map((developer) => developer.name),
      ...tickets.map((ticket) => ticket.developer),
    ].filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  const importableTicketCount = importPreview.filter(
    (row) => row.ticket && row.errors.length === 0 && !row.duplicate,
  ).length
  const importDuplicateCount = importPreview.filter((row) => row.duplicate).length
  const importInvalidCount = importPreview.filter((row) => row.errors.length > 0).length

  const allVisibleTicketsSelected =
    paginatedTickets.length > 0 &&
    paginatedTickets.every((ticket) => selectedTicketIds.includes(ticket.id))

  function toggleTicketSelection(ticketId: string) {
    setSelectedTicketIds((current) =>
      current.includes(ticketId)
        ? current.filter((id) => id !== ticketId)
        : [...current, ticketId],
    )
  }

  function toggleVisibleTicketSelection() {
    const visibleIds = paginatedTickets.map((ticket) => ticket.id)
    setSelectedTicketIds((current) =>
      allVisibleTicketsSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    )
  }

  function renderMetricComparisonPanel() {
    const periods: { period: DashboardMetricPeriod; label: string; counts: DashboardMetricCounts }[] = [
      { period: 'today', label: "Today's", counts: todayMetricCounts },
      { period: 'overall', label: 'Overall', counts: overallMetricCounts },
    ]

    return (
      <section className="metric-panel metric-comparison-panel" aria-label="Ticket summary">
        <h2>Ticket summary</h2>
        <div className="metric-comparison-grid">
          <div className="metric-comparison-header" aria-hidden="true">
            <span>Metric</span>
            <span>Today</span>
            <span>Overall</span>
          </div>
          {dashboardMetricDefinitions.map((metric) => (
            <div className="metric-comparison-row" key={metric.key}>
              <span className="metric-comparison-label">{metric.label}</span>
              {periods.map(({ period, label, counts }) => {
                const selected =
                  dashboardMetricSelection?.period === period &&
                  dashboardMetricSelection.key === metric.key
                const count = counts[metric.key]

                return (
                  <button
                    key={period}
                    type="button"
                    className={`metric-button metric-comparison-value${selected ? ' selected' : ''}`}
                    aria-label={`${label} ${metric.label}: ${count}`}
                    aria-pressed={selected}
                    title="Click to filter tickets"
                    onClick={() => {
                      if (period === 'today') {
                        setAssignedDateFilter('all')
                        setAssignedDateFrom('')
                        setAssignedDateTo('')
                      }
                      setDashboardMetricSelection((current) =>
                        current?.period === period && current.key === metric.key
                          ? null
                          : { period, key: metric.key },
                      )
                    }}
                  >
                    <strong>{count}</strong>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </section>
    )
  }

  const clearDashboardFilters = () => {
    setDashboardMetricSelection(null)
    setStatusFilter('All')
    setPriorityFilter('All')
    setSchemeFilter('All')
    setDeveloperFilter('All')
    setSearchTerm('')
    setAssignedDateFilter('all')
    setAssignedDateFrom('')
    setAssignedDateTo('')
    setSlaRiskFilter(false)
  }

  async function handleAddHoliday(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()

  const holidayName = newHolidayName.trim()

  const duplicateDate = holidays.some(
    (holiday) =>
      holiday.holiday_date === newHolidayDate &&
      holiday.id !== editingHolidayId,
  )

  if (duplicateDate) {
    alert('A holiday is already listed for that date.')
    return
  }

  let savedHoliday: Holiday

  if (editingHolidayId) {
    const { data, error } = await supabase
      .from('holidays')
      .update({
        holiday_date: newHolidayDate,
        holiday_name: holidayName,
      })
      .eq('id', editingHolidayId)
      .select('id, holiday_date, holiday_name')
      .single()

    if (error) {
      alert(`Holiday could not be updated: ${error.message}`)
      return
    }

    savedHoliday = data
  } else {
    const { data, error } = await supabase
      .from('holidays')
      .insert({
        holiday_date: newHolidayDate,
        holiday_name: holidayName,
      })
      .select('id, holiday_date, holiday_name')
      .single()

    if (error) {
      alert(`Holiday could not be saved: ${error.message}`)
      return
    }

    savedHoliday = data
  }

  const updatedHolidays = editingHolidayId
    ? holidays.map((holiday) =>
        holiday.id === savedHoliday.id ? savedHoliday : holiday,
      )
    : [...holidays, savedHoliday]

  updatedHolidays.sort((a, b) =>
    a.holiday_date.localeCompare(b.holiday_date),
  )

  setHolidays(updatedHolidays)
  setHolidayDates(
    [...new Set(updatedHolidays.map((holiday) => holiday.holiday_date))].sort(),
  )

  setEditingHolidayId(null)
  setNewHolidayDate('')
  setNewHolidayName('')
}

async function handleDeleteHoliday(holiday: Holiday) {
  const confirmed = window.confirm(
    `Delete ${holiday.holiday_name} from the holiday calendar?`,
  )

  if (!confirmed) return

  const { error } = await supabase
    .from('holidays')
    .delete()
    .eq('id', holiday.id)

  if (error) {
    alert(`Holiday could not be deleted: ${error.message}`)
    return
  }

  const updatedHolidays = holidays.filter(
    (item) => item.id !== holiday.id,
  )

  setHolidays(updatedHolidays)
  setHolidayDates(
    [...new Set(updatedHolidays.map((item) => item.holiday_date))].sort(),
  )

  if (editingHolidayId === holiday.id) {
    setEditingHolidayId(null)
    setNewHolidayDate('')
    setNewHolidayName('')
  }
}

  async function handleSaveDeveloper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isTicketAdmin || !developerListReady) return

    const name = developerDraft.trim()
    if (!name) {
      alert('Please enter a developer name.')
      return
    }

    const duplicate = developers.some(
      (developer) =>
        developer.id !== editingDeveloperId &&
        developer.name.toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) {
      alert('That developer is already in the list.')
      return
    }

    if (editingDeveloperId) {
      const { data, error } = await supabase
        .from('developers')
        .update({ name })
        .eq('id', editingDeveloperId)
        .select('id, name')
        .single()

      if (error) {
        alert(`Developer could not be replaced: ${error.message}`)
        return
      }

      setDevelopers((current) =>
        current
          .map((developer) => developer.id === data.id ? data : developer)
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      setTicketDetailsToast({
        title: 'Developer list updated',
        message: `Replaced the developer name with ${name}. Existing tickets keep their recorded name.`,
      })
    } else {
      const { data, error } = await supabase
        .from('developers')
        .insert({ name })
        .select('id, name')
        .single()

      if (error) {
        alert(`Developer could not be added: ${error.message}`)
        return
      }

      setDevelopers((current) =>
        [...current, data].sort((a, b) => a.name.localeCompare(b.name)),
      )
      setTicketDetailsToast({
        title: 'Developer added',
        message: `${name} is now available for new tickets and assignments.`,
      })
    }

    setDeveloperDraft('')
    setEditingDeveloperId(null)
  }

  async function handleRemoveDeveloper(developer: Developer) {
    if (!isTicketAdmin || !developerListReady) return
    const confirmed = window.confirm(
      `Remove ${developer.name} from the developer list? Existing tickets will keep their recorded developer.`,
    )
    if (!confirmed) return

    const { error } = await supabase
      .from('developers')
      .delete()
      .eq('id', developer.id)

    if (error) {
      alert(`Developer could not be removed: ${error.message}`)
      return
    }

    setDevelopers((current) => current.filter((item) => item.id !== developer.id))
    if (editingDeveloperId === developer.id) {
      setEditingDeveloperId(null)
      setDeveloperDraft('')
    }
    setTicketDetailsToast({
      title: 'Developer removed',
      message: `${developer.name} was removed from new assignments. Existing tickets retain that name.`,
    })
  }

  async function handleDeleteSelectedTickets() {
    if (!isTicketAdmin || selectedTicketIds.length === 0) return

    const ticketIdsToDelete = [...selectedTicketIds]
    const confirmed = window.confirm(
      `Permanently delete ${ticketIdsToDelete.length} selected ticket${ticketIdsToDelete.length === 1 ? '' : 's'} and their remarks and history?`,
    )
    if (!confirmed) return

    const { error } = await supabase.rpc('admin_delete_tickets', {
      p_ticket_ids: ticketIdsToDelete,
    })

    if (error) {
      alert(`Selected tickets could not be deleted: ${error.message}`)
      return
    }

    const removedIds = new Set(ticketIdsToDelete)
    setTickets((current) =>
      current.filter((ticket) => !removedIds.has(ticket.id)),
    )
    if (selectedTicket && removedIds.has(selectedTicket.id)) {
      setSelectedTicket(null)
    }

    setResolutionTimeByTicket((current) => {
      const next = { ...current }
      ticketIdsToDelete.forEach((id) => delete next[id])
      return next
    })
    setStatusHistory((current) => {
      const next = { ...current }
      ticketIdsToDelete.forEach((id) => delete next[id])
      return next
    })
    setAssignmentHistoryByTicket((current) => {
      const next = { ...current }
      ticketIdsToDelete.forEach((id) => delete next[id])
      return next
    })
    setRemarksByTicket((current) => {
      const next = { ...current }
      ticketIdsToDelete.forEach((id) => delete next[id])
      return next
    })
    setSelectedTicketIds([])
  }

  async function handleCreateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const ticketId = newTicketId.trim()
    if (!ticketId) {
      alert('Please enter a ticket ID.')
      return
    }

    if (!newPriority) {
      alert('Please select a priority.')
      return
    }

    const duplicateTicketId = tickets.some(
      (ticket) => ticket.id.toLowerCase() === ticketId.toLowerCase(),
    )
    if (duplicateTicketId) {
      alert('That ticket ID already exists. Please enter a unique ID.')
      return
    }

    const assignedAt = new Date(newAssignedAt)
    if (Number.isNaN(assignedAt.getTime())) {
      alert('Please enter a valid assigned time.')
      return
    }

    const slaDueAt = addBusinessHours(
      assignedAt,
      SLA_HOURS_BY_PRIORITY[newPriority],
      holidayDates,
    )

    const { data, error } = await supabase
      .from('tickets')
      .insert({
        id: ticketId,
        title: ticketId,
        priority: newPriority,
        status: 'Open',
        scheme: newScheme,
        developer: newDeveloper,
        assigned_at: assignedAt.toISOString(),
        sla_due_at: slaDueAt.toISOString(),
      })
      .select(
        'id, title, priority, status, scheme, developer, assigned_at, sla_due_at',
      )
      .single()

    if (error) {
      alert(`Ticket could not be saved: ${error.message}`)
      return
    }

    const { error: historyError } = await supabase
      .from('ticket_assignment_history')
      .insert({
        ticket_id: data.id,
        developer: data.developer,
        assigned_at: data.assigned_at,
      })

    const savedTicket: Ticket = {
      id: data.id,
      title: data.title,
      priority: data.priority as Ticket['priority'],
      status: data.status as Ticket['status'],
      scheme: data.scheme,
      developer: data.developer,
      assignedAt: data.assigned_at,
      slaDueAt: data.sla_due_at ?? undefined,
      due: data.sla_due_at ? formatDateTime(data.sla_due_at) : '—',
    }

    setTickets((currentTickets) => [savedTicket, ...currentTickets])
    setNewTicketId('')
    setNewPriority('')
    setNewScheme('')
    setNewDeveloper('')
    setNewAssignedAt(getLocalDateTimeInputValue())
    setIsFormOpen(false)

    if (historyError) {
      alert(
        `Ticket saved, but assignment history could not be saved: ${historyError.message}`,
      )
    }
  }

  async function handleImportFileSelection(file: File | undefined) {
    if (!file) return

    setImportFileName(file.name)
    setImportError('')
    setImportPreview([])

    try {
      const { data: holidayRows, error: holidayError } = await supabase
        .from('holidays')
        .select('holiday_date')
      if (holidayError) {
        setImportError(`Could not load the holiday calendar: ${holidayError.message}`)
        return
      }
      const currentHolidayDates = (holidayRows ?? []).map((row) => row.holiday_date)

      const workbook = XLSX.read(await file.arrayBuffer())
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        setImportError('This workbook does not contain a worksheet.')
        return
      }

      const worksheet = workbook.Sheets[firstSheetName]
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: true,
        defval: '',
      })
      if (matrix.length < 2) {
        setImportError('The first worksheet has no ticket rows to review.')
        return
      }

      const normalizeHeader = (value: unknown) =>
        String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase()
      const requiredHeaders = [
        'ticket id',
        'scheme',
        'developer',
        'priority',
        'resolved time',
        'request status',
        'assigned time',
      ]
      const headerSearchLimit = Math.min(matrix.length, 25)
      const headerRowIndex = matrix
        .slice(0, headerSearchLimit)
        .findIndex((row) => {
          const normalizedHeaders = new Set(row.map(normalizeHeader))
          return requiredHeaders.every((header) => normalizedHeaders.has(header))
        })

      if (headerRowIndex < 0) {
        const bestHeaderRow = matrix
          .slice(0, headerSearchLimit)
          .map((row, index) => ({
            index,
            headers: new Set(row.map(normalizeHeader)),
          }))
          .sort((left, right) =>
            requiredHeaders.filter((header) => right.headers.has(header)).length -
            requiredHeaders.filter((header) => left.headers.has(header)).length,
          )[0]
        const missingHeaders = requiredHeaders.filter(
          (header) => !bestHeaderRow?.headers.has(header),
        )

        setImportError(
          bestHeaderRow && missingHeaders.length < requiredHeaders.length
            ? `Could not find all required columns in the first ${headerSearchLimit} rows. The closest header row is row ${bestHeaderRow.index + 1}; missing: ${missingHeaders.join(', ')}.`
            : `Could not find the required header row in the first ${headerSearchLimit} rows. Expected: ${requiredHeaders.join(', ')}.`,
        )
        return
      }

      const headerIndexes = new Map<string, number>(
        (matrix[headerRowIndex] ?? []).map(
          (header, index): [string, number] => [normalizeHeader(header), index],
        ),
      )

      const getCell = (row: unknown[], header: string) => {
        const index = headerIndexes.get(header)
        return index === undefined ? '' : row[index] ?? ''
      }
      const existingIds = new Set(tickets.map((ticket) => ticket.id.toLowerCase()))
      const seenIds = new Set<string>()
      const parsedPreview: ImportPreviewRow[] = []

      matrix.slice(headerRowIndex + 1).forEach((row, index) => {
        if (row.every((cell) => String(cell ?? '').trim() === '')) return

        const rowNumber = index + headerRowIndex + 2
        const rawId = getCell(row, 'ticket id')
        const ticketId = typeof rawId === 'number' && Number.isFinite(rawId)
          ? String(Math.trunc(rawId))
          : String(rawId ?? '').trim()
        const scheme = String(getCell(row, 'scheme') ?? '').trim()
        const developer = String(getCell(row, 'developer') ?? '').trim()
        const priorityText = String(getCell(row, 'priority') ?? '').trim().toUpperCase()
        const statusText = String(getCell(row, 'request status') ?? '').trim()
        const assignedText = String(getCell(row, 'assigned time') ?? '').trim()
        const resolvedText = String(getCell(row, 'resolved time') ?? '').trim()
        const errors: string[] = []
        const warnings: string[] = []

        if (!ticketId) errors.push('Ticket ID is missing')
        if (!scheme) errors.push('Scheme is missing')
        if (!developer) errors.push('Developer is missing')
        if (!['P1', 'P2', 'P3', 'P4'].includes(priorityText)) {
          errors.push(`Unknown priority: ${priorityText || 'blank'}`)
        }

        const status = mapImportedStatus(statusText)
        if (!status) errors.push(`Unknown status: ${statusText || 'blank'}`)

        const assignedAt = parseIndiaTimestamp(assignedText)
        if (!assignedAt) errors.push('Assigned time must use DD-MM-YYYY HH:mm')

        let resolvedAt: string | null = null
        const noResolvedTime = !resolvedText || resolvedText.toLowerCase() === 'not assigned'
        if (status === 'Resolved') {
          if (noResolvedTime) {
            errors.push('Resolved ticket has no resolved time')
          } else {
            resolvedAt = parseIndiaTimestamp(resolvedText)
            if (!resolvedAt) errors.push('Resolved time must use DD-MM-YYYY HH:mm')
          }
        } else if (!noResolvedTime) {
          const parsedResolvedAt = parseIndiaTimestamp(resolvedText)
          if (!parsedResolvedAt) {
            errors.push('Resolved time must use DD-MM-YYYY HH:mm or Not Assigned')
          } else {
            warnings.push('Resolved time present, but status is unresolved; it will be left blank')
          }
        }

        if (assignedAt && resolvedAt && new Date(resolvedAt) < new Date(assignedAt)) {
          warnings.push('Resolved time is before assigned time; imported as provided')
        }

        const duplicate = ticketId !== '' && (
          existingIds.has(ticketId.toLowerCase()) || seenIds.has(ticketId.toLowerCase())
        )
        if (ticketId) seenIds.add(ticketId.toLowerCase())

        let ticket: ImportTicketPayload | null = null
        if (errors.length === 0 && status && assignedAt) {
          const priority = priorityText as Ticket['priority']
          const slaDueAt = addBusinessHours(
            new Date(assignedAt),
            SLA_HOURS_BY_PRIORITY[priority],
            currentHolidayDates,
          ).toISOString()

          ticket = {
            id: ticketId,
            title: ticketId,
            priority,
            status,
            scheme,
            developer,
            assigned_at: assignedAt,
            sla_due_at: slaDueAt,
            resolved_at: resolvedAt,
            on_hold_started_at: null,
          }
        }

        parsedPreview.push({
          rowNumber,
          ticketId,
          statusText,
          assignedText,
          resolvedText,
          ticket,
          duplicate,
          errors,
          warnings,
        })
      })

      if (parsedPreview.length === 0) {
        setImportError('No non-empty ticket rows were found in the first worksheet.')
        return
      }

      setImportPreview(parsedPreview)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The workbook could not be read.'
      setImportError(`Could not read this spreadsheet: ${message}`)
    }
  }

  async function handleImportTickets() {
    if (isImporting) return

    const rowsToImport = importPreview.filter(
      (row) => row.ticket && row.errors.length === 0 && !row.duplicate,
    )
    const duplicateCount = importPreview.filter((row) => row.duplicate).length
    const invalidCount = importPreview.filter((row) => row.errors.length > 0).length
    if (rowsToImport.length === 0) return

    const confirmed = window.confirm(
      `Import ${rowsToImport.length} ticket${rowsToImport.length === 1 ? '' : 's'}? ${duplicateCount} duplicate row${duplicateCount === 1 ? '' : 's'} and ${invalidCount} invalid row${invalidCount === 1 ? '' : 's'} will be skipped.`,
    )
    if (!confirmed) return

    setIsImporting(true)
    setImportError('')
    const importTime = new Date().toISOString()
    const payload = rowsToImport.map(({ ticket }) => ({
      ...ticket!,
      on_hold_started_at:
        ticket!.status === 'On Hold' || ticket!.status === 'Business Pending'
          ? importTime
          : null,
    }))

    const { data, error } = await supabase.rpc('admin_import_tickets', {
      p_tickets: payload,
    })

    if (error) {
      setImportError(`Tickets could not be imported: ${error.message}`)
      setIsImporting(false)
      return
    }

    const insertedIds = new Set(
      (data ?? []).map((row: { ticket_id: string }) => row.ticket_id),
    )
    const importedTickets: Ticket[] = payload
      .filter((ticket) => insertedIds.has(ticket.id))
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        priority: ticket.priority,
        status: ticket.status,
        scheme: ticket.scheme,
        developer: ticket.developer,
        assignedAt: ticket.assigned_at,
        slaDueAt: ticket.sla_due_at,
        resolvedAt: ticket.resolved_at ?? undefined,
        onHoldStartedAt: ticket.on_hold_started_at ?? undefined,
        due:
          ticket.status === 'On Hold' || ticket.status === 'Business Pending'
            ? 'Paused'
            : formatDateTime(ticket.sla_due_at),
      }))

    if (importedTickets.length > 0) {
      setTickets((currentTickets) => [...importedTickets, ...currentTickets])
      setResolutionTimeByTicket((current) => ({
        ...current,
        ...Object.fromEntries(
          importedTickets
            .filter((ticket) => ticket.resolvedAt)
            .map((ticket) => [ticket.id, ticket.resolvedAt as string]),
        ),
      }))
    }

    const serverSkippedCount = rowsToImport.length - importedTickets.length
    setIsImportOpen(false)
    setImportPreview([])
    setImportFileName('')
    setImportError('')
    setTicketDetailsToast({
      title: importedTickets.length > 0 ? 'Import completed' : 'No new tickets added',
      message: importedTickets.length > 0
        ? `${importedTickets.length} ticket${importedTickets.length === 1 ? '' : 's'} added. ${duplicateCount + serverSkippedCount} duplicate${duplicateCount + serverSkippedCount === 1 ? '' : 's'} skipped; ${invalidCount} invalid row${invalidCount === 1 ? '' : 's'} skipped.`
        : 'All valid ticket IDs already exist in the app.',
    })
    setIsImporting(false)
  }

  async function exportVisibleTickets() {
    if (filteredTickets.length === 0) return

    const ticketIds = filteredTickets.map((ticket) => ticket.id)
    const { data: remarkRows, error } = await supabase
      .from('ticket_remarks')
      .select('ticket_id, remark, created_at')
      .in('ticket_id', ticketIds)
      .order('created_at', { ascending: true })

    if (error) {
      alert(`Remarks could not be loaded for the export: ${error.message}`)
      return
    }

    const remarkHistoryByTicket = (remarkRows ?? []).reduce<Record<string, string[]>>(
      (history, row) => {
        const entries = history[row.ticket_id] ?? []
        entries.push(`${formatDateTime(row.created_at)} — ${row.remark}`)
        history[row.ticket_id] = entries
        return history
      },
      {},
    )

    const exportRows = filteredTickets.map((ticket) => ({
      'Ticket ID': ticket.id,
      Scheme: ticket.scheme || '',
      Developer: ticket.developer || '',
      Priority: ticket.priority,
      Status: ticket.status,
      'Assigned time': ticket.assignedAt ? formatDateTime(ticket.assignedAt) : '',
      'Resolved time': resolutionTimeByTicket[ticket.id]
        ? formatDateTime(resolutionTimeByTicket[ticket.id])
        : '',
      'SLA due': ticket.due || '',
      'SLA result': getSlaStatusLabel(ticket),
      'Reviewed SLA': getReviewedSlaStatusLabel(ticket),
      Remark: ticket.reviewedSlaRemark || '',
      'Remark history': (remarkHistoryByTicket[ticket.id] ?? []).join('\n'),
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    worksheet['!cols'] = [
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
      { wch: 10 },
      { wch: 20 },
      { wch: 24 },
      { wch: 24 },
      { wch: 24 },
      { wch: 18 },
      { wch: 20 },
      { wch: 48 },
      { wch: 48 },
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tickets')
    const now = new Date()
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    XLSX.writeFile(workbook, `qa-ticket-export-${today}.xlsx`)
  }

  async function handleAddRemark() {
    if (!selectedTicket || !newRemark.trim()) {
      return
    }

    const { data, error } = await supabase
      .from('ticket_remarks')
      .insert({
        ticket_id: selectedTicket.id,
        remark: newRemark.trim(),
      })
      .select('remark, created_at')
      .single()

    if (error) {
      alert(`Remark could not be saved: ${error.message}`)
      return
    }

    const savedRemark = `${formatDateTime(data.created_at)} — ${data.remark}`

    setRemarksByTicket((currentRemarks) => ({
      ...currentRemarks,
      [selectedTicket.id]: [
        ...(currentRemarks[selectedTicket.id] ?? []),
        savedRemark,
      ],
    }))

    setNewRemark('')
  }

  async function handleSaveSlaReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!slaReviewTicket || !slaReviewRemark.trim()) return

    setIsSavingSlaReview(true)
    const reviewedSlaOverride =
      slaReviewSelection === 'Within SLA' ? 'Within SLA' : null
    const remark = slaReviewRemark.trim()

    try {
      const { error } = await supabase.rpc('review_ticket_sla', {
        p_ticket_id: slaReviewTicket.id,
        p_reviewed_sla_override: reviewedSlaOverride,
        p_remark: remark,
      })

      if (error) {
        alert('SLA review could not be saved: ' + error.message)
        return
      }

      const reviewedAt = new Date().toISOString()
      const reviewer = session?.user.email ?? ''
      const updatedTicket: Ticket = {
        ...slaReviewTicket,
        reviewedSlaOverride,
        reviewedSlaRemark: remark,
        reviewedSlaAt: reviewedAt,
        reviewedSlaBy: reviewer,
      }

      setTickets((current) =>
        current.map((ticket) =>
          ticket.id === updatedTicket.id ? updatedTicket : ticket,
        ),
      )
      setRemarksByTicket((current) => ({
        ...current,
        [updatedTicket.id]: [
          ...(current[updatedTicket.id] ?? []),
          formatDateTime(reviewedAt) + ' — SLA review: ' + slaReviewSelection + '. ' + remark,
        ],
      }))
      setTicketDetailsToast({
        title: 'SLA review saved',
        message: updatedTicket.id + ' reviewed as ' + slaReviewSelection + '.',
      })
      setSlaReviewTicket(null)
      setSlaReviewRemark('')
    } finally {
      setIsSavingSlaReview(false)
    }
  }

  async function handleStatusChange(newStatus: Ticket['status']) {
    if (!selectedTicket) return

    const previousStatus = selectedTicket.status
    const wasPaused =
      previousStatus === 'On Hold' || previousStatus === 'Business Pending'
    const willBePaused =
      newStatus === 'On Hold' || newStatus === 'Business Pending'
    const now = new Date()

    const updates: {
      status: Ticket['status']
      on_hold_started_at?: string | null
      sla_due_at?: string
      resolved_at?: string | null
    } = { status: newStatus }

    if (newStatus === 'Resolved') {
      updates.resolved_at = now.toISOString()
    } else if (previousStatus === 'Resolved') {
      updates.resolved_at = null
    }

    let nextSlaDueAt: Date | null = null

    if (willBePaused && !wasPaused) {
      updates.on_hold_started_at = now.toISOString()
    }

    if (wasPaused && !willBePaused) {
      updates.on_hold_started_at = null

      if (selectedTicket.onHoldStartedAt && selectedTicket.slaDueAt) {
        const pausedBusinessHours = getBusinessHoursBetween(
          new Date(selectedTicket.onHoldStartedAt),
          now,
          holidayDates,
        )

        if (pausedBusinessHours > 0) {
          nextSlaDueAt = addBusinessHours(
            new Date(selectedTicket.slaDueAt),
            pausedBusinessHours,
            holidayDates,
          )
          updates.sla_due_at = nextSlaDueAt.toISOString()
        }
      }
    }

    const { error } = await supabase
      .from('tickets')
      .update(updates)
      .eq('id', selectedTicket.id)

    if (error) {
      alert(`Status could not be saved: ${error.message}`)
      return
    }

    const { error: historyError } = await supabase
      .from('ticket_status_history')
      .insert({
        ticket_id: selectedTicket.id,
        from_status: previousStatus,
        to_status: newStatus,
      })

    if (historyError) {
      alert(
        `Status changed, but its history could not be saved: ${historyError.message}`,
      )
    }

    const updatedTicket: Ticket = {
      ...selectedTicket,
      status: newStatus,
      resolvedAt:
        newStatus === 'Resolved'
          ? now.toISOString()
          : previousStatus === 'Resolved'
            ? undefined
            : selectedTicket.resolvedAt,
      onHoldStartedAt: willBePaused
        ? selectedTicket.onHoldStartedAt ?? now.toISOString()
        : undefined,
      slaDueAt: nextSlaDueAt?.toISOString() ?? selectedTicket.slaDueAt,
      due: willBePaused
        ? 'Paused'
        : nextSlaDueAt
          ? formatDateTime(nextSlaDueAt)
          : wasPaused
            ? selectedTicket.slaDueAt
              ? formatDateTime(selectedTicket.slaDueAt)
              : '—'
            : selectedTicket.due,
    }

    setTickets((currentTickets) =>
      currentTickets.map((ticket) =>
        ticket.id === selectedTicket.id ? updatedTicket : ticket,
      ),
    )
    setSelectedTicket(updatedTicket)

    setResolutionTimeByTicket((current) => {
      const next = { ...current }
      if (newStatus === 'Resolved') next[selectedTicket.id] = now.toISOString()
      else delete next[selectedTicket.id]
      return next
    })

    setStatusHistory((history) => ({
      ...history,
      [selectedTicket.id]: [
        ...(history[selectedTicket.id] ?? []),
        `${previousStatus} → ${newStatus} · ${formatDateTime(now)}`,
      ],
    }))
  }

  async function handleDeveloperChange(newDeveloper: string) {
  if (!selectedTicket || newDeveloper === selectedTicket.developer) return

  const assignedAt = new Date()

  const { error } = await supabase
    .from('tickets')
    .update({ developer: newDeveloper })
    .eq('id', selectedTicket.id)

  if (error) {
    alert(`Developer could not be changed: ${error.message}`)
    return
  }

  const { error: historyError } = await supabase
    .from('ticket_assignment_history')
    .insert({
      ticket_id: selectedTicket.id,
      developer: newDeveloper,
      assigned_at: assignedAt.toISOString(),
    })

  if (historyError) {
    alert(
      `Developer changed, but assignment history could not be saved: ${historyError.message}`,
    )
  }

  const updatedTicket = { ...selectedTicket, developer: newDeveloper }

  setTickets((currentTickets) =>
    currentTickets.map((ticket) =>
      ticket.id === selectedTicket.id ? updatedTicket : ticket,
    ),
  )
  setSelectedTicket(updatedTicket)

  setAssignmentHistoryByTicket((history) => ({
    ...history,
    [selectedTicket.id]: [
      ...(history[selectedTicket.id] ?? []),
      `Assigned to ${newDeveloper} · ${formatDateTime(assignedAt)}`,
    ],
  }))
}

async function handleUpdateTicketDetails(
  event: FormEvent<HTMLFormElement>,
) {
  event.preventDefault()
  if (!selectedTicket) return
  setTicketDetailsToast(null)

  const formData = new FormData(event.currentTarget)
  const title = String(formData.get('title') ?? '').trim()
  const scheme = String(formData.get('scheme') ?? '')
  const priority = String(
    formData.get('priority') ?? selectedTicket.priority,
  ) as Ticket['priority']

  if (!title) {
    alert('Please enter an issue title.')
    return
  }

  const changedFields: string[] = []
  if (title !== selectedTicket.title) changedFields.push('Issue title')
  if (scheme !== selectedTicket.scheme) changedFields.push('Scheme')
  if (priority !== selectedTicket.priority) changedFields.push('Priority')

  if (changedFields.length === 0) {
    setTicketDetailsToast({
      title: 'No changes to save',
      message: 'The ticket details are already up to date.',
    })
    return
  }

  const { error } = await supabase
    .from('tickets')
    .update({ title, scheme, priority })
    .eq('id', selectedTicket.id)

  if (error) {
    alert(`Ticket details could not be saved: ${error.message}`)
    return
  }

  const updatedTicket = { ...selectedTicket, title, scheme, priority, }

  setTickets((currentTickets) =>
    currentTickets.map((ticket) =>
      ticket.id === selectedTicket.id ? updatedTicket : ticket,
    ),
  )
  setSelectedTicket(updatedTicket)
  setTicketDetailsToast({
    title: 'Saved successfully',
    message: `Updated: ${changedFields.join(', ')}`,
  })
}

  async function handleUpdateTicketTimes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isTicketAdmin || !selectedTicket) return

    const formData = new FormData(event.currentTarget)
    const assignedAt = new Date(String(formData.get('assignedAt') ?? ''))
    if (Number.isNaN(assignedAt.getTime())) {
      alert('Please enter a valid assigned date and time.')
      return
    }

    let resolvedAt: Date | null = null
    if (selectedTicket.status === 'Resolved') {
      const resolvedText = String(formData.get('resolvedAt') ?? '')
      resolvedAt = resolvedText ? new Date(resolvedText) : null
      if (!resolvedAt || Number.isNaN(resolvedAt.getTime())) {
        alert('Please enter a valid resolved date and time for this resolved ticket.')
        return
      }
    }

    const assignedAtIso = assignedAt.toISOString()
    const resolvedAtIso = resolvedAt?.toISOString()
    const assignedInput = String(formData.get('assignedAt') ?? '')
    const previousResolvedAt =
      resolutionTimeByTicket[selectedTicket.id] ?? selectedTicket.resolvedAt
    const assignedChanged =
      toLocalDateTimeInputValue(selectedTicket.assignedAt) !== assignedInput
    const resolvedChanged = selectedTicket.status === 'Resolved' &&
      toLocalDateTimeInputValue(previousResolvedAt) !==
        String(formData.get('resolvedAt') ?? '')

    const changedFields: string[] = []
    if (assignedChanged) changedFields.push('Assigned time')
    if (resolvedChanged) changedFields.push('Resolved time')
    if (changedFields.length === 0) return

    const nextSlaDueAt = assignedChanged
      ? addBusinessHours(
          assignedAt,
          SLA_HOURS_BY_PRIORITY[selectedTicket.priority],
          holidayDates,
        )
      : null

    const { error } = await supabase.rpc('admin_update_ticket_times', {
      p_ticket_id: selectedTicket.id,
      p_assigned_at: assignedAtIso,
      p_resolved_at:
        selectedTicket.status === 'Resolved' ? resolvedAtIso ?? null : null,
      p_sla_due_at: nextSlaDueAt?.toISOString() ?? null,
    })

    if (error) {
      alert(`Ticket dates could not be saved: ${error.message}`)
      return
    }

    const updatedTicket: Ticket = {
      ...selectedTicket,
      assignedAt: assignedAtIso,
      resolvedAt: resolvedAtIso ?? selectedTicket.resolvedAt,
      slaDueAt: nextSlaDueAt?.toISOString() ?? selectedTicket.slaDueAt,
      due:
        selectedTicket.status === 'On Hold' || selectedTicket.status === 'Business Pending'
          ? 'Paused'
          : nextSlaDueAt
            ? formatDateTime(nextSlaDueAt)
            : selectedTicket.due,
    }

    setTickets((currentTickets) =>
      currentTickets.map((ticket) =>
        ticket.id === selectedTicket.id ? updatedTicket : ticket,
      ),
    )
    setSelectedTicket(updatedTicket)
    if (selectedTicket.status === 'Resolved' && resolvedAtIso) {
      setResolutionTimeByTicket((current) => ({
        ...current,
        [selectedTicket.id]: resolvedAtIso,
      }))
    }
    setTicketDetailsToast({
      title: 'Ticket times updated',
      message: `Updated: ${changedFields.join(', ')}${assignedChanged ? '. SLA due recalculated.' : '.'}`,
    })
  }

  if (authLoading) {
    return <p>Loading…</p>
  }

  if (isPasswordRecovery && session) {
    return (
      <PasswordRecovery
        onComplete={() => {
          setIsPasswordRecovery(false)
          window.history.replaceState(null, '', window.location.pathname)
        }}
      />
    )
  }

  if (!session) {
    return <Auth />
  }

  return (
    <main className="app">
      {ticketDetailsToast && (
        <div className="save-success-toast" role="status" aria-live="polite">
          <span className="save-success-icon" aria-hidden="true">✓</span>
          <div className="save-success-copy">
            <strong>{ticketDetailsToast.title}</strong>
            <span>{ticketDetailsToast.message}</span>
          </div>
          <button
            className="save-success-dismiss"
            type="button"
            aria-label="Dismiss success message"
            onClick={() => setTicketDetailsToast(null)}
          >
            ×
          </button>
        </div>
      )}
      <header className="topbar">
  <div className="header-primary-actions">
  <button
    className="primary-button"
    type="button"
    onClick={() => {
      const now = new Date()
      const localDateTime = new Date(
        now.getTime() - now.getTimezoneOffset() * 60_000,
      )
        .toISOString()
        .slice(0, 16)

      setNewAssignedAt(localDateTime)
      setNewPriority('')
      setIsFormOpen(true)
    }}
  >
    ＋ New ticket
  </button>
  <button
    className="secondary-button import-open-button"
    type="button"
    onClick={() => {
      setImportError('')
      setImportPreview([])
      setImportFileName('')
      setIsImportOpen(true)
    }}
  >
    ⇧ Import Excel
  </button>
  <button
    className="secondary-button export-open-button"
    type="button"
    disabled={filteredTickets.length === 0}
    onClick={() => void exportVisibleTickets()}
    title="Download all tickets matching current filters and search, across every page"
  >
    ⇩ Export Excel ({filteredTickets.length})
  </button>
  </div>

  <div className="dashboard-title">
    <p className="eyebrow">INFONEO TEAM QUALITY OPERATIONS</p>
    <h1>Ticket dashboard</h1>
  </div>

  <button
    className="header-signout-button"
    type="button"
    onClick={async () => {
      const { error } = await supabase.auth.signOut()
      if (error) alert(`Could not sign out: ${error.message}`)
    }}
  >
    Sign out
  </button>
</header>

      <div className="dashboard-layout">
        <aside className="dashboard-left">
          {renderMetricComparisonPanel()}
          <aside className="dashboard-right">
            <section className="date-filter-panel">
              <div className="assigned-date-range">
                <label>
                  From
                  <input
                    type="date"
                    aria-label="Assigned date from"
                    value={assignedDateFrom}
                    max={assignedDateTo || undefined}
                    onChange={(event) => {
                      setAssignedDateFrom(event.target.value)
                      setAssignedDateFilter('all')
                      setDashboardMetricSelection((current) =>
                        current?.period === 'today' ? null : current,
                      )
                    }}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    aria-label="Assigned date to"
                    value={assignedDateTo}
                    min={assignedDateFrom || undefined}
                    onChange={(event) => {
                      setAssignedDateTo(event.target.value)
                      setAssignedDateFilter('all')
                      setDashboardMetricSelection((current) =>
                        current?.period === 'today' ? null : current,
                      )
                    }}
                  />
                </label>
              </div>
              {assignedDateRangeInvalid && (
                <p className="assigned-date-range-error">From date must be on or before To date.</p>
              )}
              <h2>Filter by assigned date</h2>
              <div className="date-filter-list">
                {assignedDateOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`date-filter-button${!hasCustomAssignedDateRange && assignedDateFilter === option.value ? ' selected' : ''}`}
                    aria-pressed={!hasCustomAssignedDateRange && assignedDateFilter === option.value}
                    onClick={() => {
                      setAssignedDateFrom('')
                      setAssignedDateTo('')
                      setAssignedDateFilter(option.value)
                      setDashboardMetricSelection((current) =>
                        current?.period === 'today' ? null : current,
                      )
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="holiday-panel">
              <h2>Holiday calendar</h2>
              <p>Holidays are excluded from SLA calculations.</p>
              {isTicketAdmin && (
                <form onSubmit={handleAddHoliday} className="holiday-form">
                  <label>
                    Holiday date
                    <input
                      type="date"
                      required
                      value={newHolidayDate}
                      onChange={(event) => setNewHolidayDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Holiday name
                    <input
                      required
                      value={newHolidayName}
                      onChange={(event) => setNewHolidayName(event.target.value)}
                      placeholder="Holiday name"
                    />
                  </label>
                  {editingHolidayId && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditingHolidayId(null)
                        setNewHolidayDate('')
                        setNewHolidayName('')
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                  <button className="primary-button holiday-submit" type="submit">
                    {editingHolidayId ? 'Save changes' : 'Add holiday'}
                  </button>
                </form>
              )}

              {holidays.length > 0 ? (
                <ul className="holiday-list">
                  {holidays.map((holiday) => (
                    <li key={holiday.id}>
                      <span>
                        {holiday.holiday_date.split('-').reverse().join('/')} — {holiday.holiday_name}
                      </span>
                      {isTicketAdmin && (
                        <div>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              setEditingHolidayId(holiday.id)
                              setNewHolidayDate(holiday.holiday_date)
                              setNewHolidayName(holiday.holiday_name)
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-button danger"
                            onClick={() => void handleDeleteHoliday(holiday)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-holidays">
                  {isTicketAdmin ? 'No holidays added yet.' : 'No holidays are currently listed.'}
                </p>
              )}
            </section>

            {isTicketAdmin && (
              <section className="developer-admin-panel">
                <h2>Developer list</h2>
                <p>Manage names available for new tickets and assignments. Changes here do not rewrite existing tickets.</p>
                {developerListReady ? (
                  <>
                    <form onSubmit={handleSaveDeveloper} className="developer-admin-form">
                      <label>
                        {editingDeveloperId ? 'Replace developer name' : 'Add a developer'}
                        <input
                          required
                          value={developerDraft}
                          onChange={(event) => setDeveloperDraft(event.target.value)}
                          placeholder="Developer name"
                        />
                      </label>
                      <button className="primary-button holiday-submit" type="submit">
                        {editingDeveloperId ? 'Save replacement' : 'Add developer'}
                      </button>
                      {editingDeveloperId && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setEditingDeveloperId(null)
                            setDeveloperDraft('')
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </form>
                    {developers.length > 0 ? (
                      <ul className="developer-admin-list">
                        {developers.map((developer) => (
                          <li key={developer.id}>
                            <span>{developer.name}</span>
                            <div>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => {
                                  setEditingDeveloperId(developer.id)
                                  setDeveloperDraft(developer.name)
                                }}
                              >
                                Replace
                              </button>
                              <button
                                type="button"
                                className="text-button danger"
                                onClick={() => void handleRemoveDeveloper(developer)}
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty-holidays">No developers are listed yet.</p>
                    )}
                  </>
                ) : (
                  <p className="empty-holidays">Run the developer list setup in Supabase once to enable management.</p>
                )}
              </section>
            )}
          </aside>
        </aside>

        <section className="ticket-section dashboard-tickets">
          <div className="section-heading tickets-heading">
            <div>
              <h2>Tickets</h2>
              <p>Track assignments and service-level targets.</p>
            </div>
            <div className="ticket-controls">
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="All">All statuses</option>
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="On Hold">On Hold</option>
                <option value="Business Pending">Business Pending</option>
                <option value="Resolved">Resolved</option>
              </select>
              <select
                aria-label="Filter by priority"
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value)}
              >
                <option value="All">All priorities</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
              <select
                value={schemeFilter}
                onChange={(event) => setSchemeFilter(event.target.value)}
                aria-label="Filter by scheme"
              >
                <option value="All">All schemes</option>
                {availableSchemeOptions.map((scheme) => (
                  <option key={scheme} value={scheme}>{scheme}</option>
                ))}
              </select>
              <select
                value={developerFilter}
                onChange={(event) => setDeveloperFilter(event.target.value)}
                aria-label="Filter by developer"
              >
                <option value="All">All developers</option>
                {availableDeveloperOptions.map((developer) => (
                  <option key={developer} value={developer}>{developer}</option>
                ))}
              </select>
              <button
                type="button"
                className="sla-risk-filter-button"
                aria-label="Filter tickets with SLA due within one hour"
                aria-pressed={slaRiskFilter}
                title="Show open or in-progress tickets due within the next hour"
                onClick={() => setSlaRiskFilter((active) => !active)}
              >
                SLA at risk <span>{slaAtRiskCount}</span>
              </button>
              <input
                aria-label="Search tickets"
                placeholder="Search tickets…"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>

          {isTicketAdmin && (
            <div className="bulk-actions-bar">
              <span>{selectedTicketIds.length} selected</span>
              <div>
                <button
                  type="button"
                  className="danger-button"
                  disabled={selectedTicketIds.length === 0}
                  onClick={() => void handleDeleteSelectedTickets()}
                >
                  Delete selected
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={selectedTicketIds.length === 0}
                  onClick={() => setSelectedTicketIds([])}
                >
                  Clear selection
                </button>
              </div>
            </div>
          )}
          {(dashboardMetricSelection || searchTerm || statusFilter !== 'All' ||
            priorityFilter !== 'All' || schemeFilter !== 'All' ||
            developerFilter !== 'All' || assignedDateFilter !== 'all' ||
            assignedDateFrom || assignedDateTo || slaRiskFilter) && (
            <div className="active-filter-row">
              <span>{filteredTickets.length} matching ticket{filteredTickets.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={clearDashboardFilters}>Clear filters</button>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isTicketAdmin && (
                    <th className="selection-cell">
                      <input
                        type="checkbox"
                        aria-label="Select all tickets on this page"
                        checked={allVisibleTicketsSelected}
                        onChange={toggleVisibleTicketSelection}
                      />
                    </th>
                  )}
                  <th>Ticket</th>
                  <th>Scheme</th>
                  <th>Developer</th>
                  <th>Priority</th>
                  <th>Assigned time</th>
                  <th>Resolved time</th>
                  <th>SLA due</th>
                  <th>SLA violated</th>
                  <th>Status</th>
                  <th>Reviewed SLA</th>
                  <th>Remark</th>
                </tr>
              </thead>
              <tbody>
                {paginatedTickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => {
                      setTicketDetailsToast(null)
                      setSelectedTicket(ticket)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {isTicketAdmin && (
                      <td
                        className="selection-cell"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ticket ${ticket.id}`}
                          checked={selectedTicketIds.includes(ticket.id)}
                          onChange={() => toggleTicketSelection(ticket.id)}
                        />
                      </td>
                    )}
                    <td className="ticket-id">
                      <span>{ticket.id}</span>
                      {ticket.title !== ticket.id && (
                        <small>{ticket.title}</small>
                      )}
                    </td>
                    <td>{ticket.scheme || '—'}</td>
                    <td>{ticket.developer || '—'}</td>
                    <td>
                      <span className={`priority ${ticket.priority.toLowerCase()}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td>{ticket.assignedAt ? formatDateTime(ticket.assignedAt) : '—'}</td>
                    <td>
                      {resolutionTimeByTicket[ticket.id]
                        ? formatDateTime(resolutionTimeByTicket[ticket.id])
                        : '—'}
                    </td>
                    <td>{ticket.due}</td>
                    <td>
                      <span
                        className={"sla-status " + (getSlaStatusLabel(ticket) === 'Within SLA'
                          ? 'within'
                          : getSlaStatusLabel(ticket) === 'SLA Violated'
                            ? 'violated'
                            : 'unknown')}
                      >
                        {getSlaStatusLabel(ticket)}
                      </span>
                    </td>
                    <td><span className="status">{ticket.status}</span></td>
                    <td>
                      {getSlaStatusLabel(ticket) === 'SLA Violated' ||
                      ticket.reviewedSlaOverride === 'Within SLA' ? (
                        <button
                          type="button"
                          className="sla-review-trigger"
                          aria-label={'Review SLA for ' + ticket.id}
                          title={
                            ticket.reviewedSlaAt
                              ? 'Last reviewed ' + formatDateTime(ticket.reviewedSlaAt) +
                                (ticket.reviewedSlaBy ? ' by ' + ticket.reviewedSlaBy : '')
                              : 'Review this SLA result and add a remark'
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            setSlaReviewTicket(ticket)
                            setSlaReviewSelection(
                              getReviewedSlaStatusLabel(ticket) === 'Within SLA'
                                ? 'Within SLA'
                                : 'SLA Violated',
                            )
                            setSlaReviewRemark('')
                          }}
                        >
                          <span
                            className={"sla-status " + (getReviewedSlaStatusLabel(ticket) === 'Within SLA'
                              ? 'within'
                              : 'violated')}
                          >
                            {getReviewedSlaStatusLabel(ticket)}
                          </span>
                          <small>{ticket.reviewedSlaOverride ? 'Edit review' : 'Review'}</small>
                        </button>
                      ) : (
                        <span
                          className={"sla-status " + (getReviewedSlaStatusLabel(ticket) === 'Within SLA'
                            ? 'within'
                            : 'unknown')}
                        >
                          {getReviewedSlaStatusLabel(ticket)}
                        </span>
                      )}
                    </td>
                    <td
                      className="review-remark-cell"
                      title={ticket.reviewedSlaRemark || ''}
                    >
                      {ticket.reviewedSlaRemark || '—'}
                    </td>
                  </tr>
                ))}
                {filteredTickets.length === 0 && (
                  <tr><td colSpan={isTicketAdmin ? 12 : 11}>No tickets match the selected filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredTickets.length > 0 && (
            <div className="pagination-bar">
              <span>
                Showing <strong>{firstVisibleTicket}–{lastVisibleTicket}</strong> of{' '}
                <strong>{filteredTickets.length}</strong> matching tickets
              </span>
              <div className="pagination-controls">
                <label className="page-size-control">
                  Rows per page
                  <select
                    value={ticketPageSize}
                    onChange={(event) => setTicketPageSize(Number(event.target.value))}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={visiblePage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <span>Page {visiblePage} of {totalTicketPages}</span>
                <button
                  type="button"
                  disabled={visiblePage >= totalTicketPages}
                  onClick={() => setCurrentPage((page) => Math.min(totalTicketPages, page + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>


      </div>

      {selectedTicket && (
        <div
          className="ticket-detail-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedTicket(null)
          }}
        >
          <aside
            className="ticket-detail-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Ticket details"
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">Ticket details</p>
              </div>
              <button
                className="icon-close-button"
                type="button"
                aria-label="Close ticket details"
                onClick={() => setSelectedTicket(null)}
              >
                ×
              </button>
            </div>

            <div className="detail-overview-grid">
              <div className="detail-ticket-id-card">
                <span>Ticket ID</span>
                <strong>{selectedTicket.id}</strong>
              </div>
              <label className="detail-field">
                <span>Status</span>
                <select
                  value={selectedTicket.status}
                  onChange={(event) =>
                    void handleStatusChange(event.target.value as Ticket['status'])
                  }
                >
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="On Hold">On Hold</option>
                  <option value="Business Pending">Business Pending</option>
                  <option value="Resolved">Resolved</option>
                </select>
              </label>
            </div>

            <form
              className="detail-edit-form"
              key={selectedTicket.id}
              onSubmit={handleUpdateTicketDetails}
            >
              <div className="detail-form-row detail-title-developer-row">
                <label className="detail-field">
                  <span>Issue title</span>
                  <input name="title" required defaultValue={selectedTicket.title} />
                </label>

                <label className="detail-field">
                  <span>Developer</span>
                  <select
                    value={selectedTicket.developer}
                    onChange={(event) => void handleDeveloperChange(event.target.value)}
                  >
                    <option value="">Select a developer</option>
                    {availableDeveloperOptions.map((developer) => (
                      <option key={developer} value={developer}>
                        {developer}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="detail-form-row">
                <label className="detail-field">
                  <span>Scheme</span>
                  <select name="scheme" defaultValue={selectedTicket.scheme}>
                    <option value="">Select a scheme</option>
                    {availableSchemeOptions.map((scheme) => (
                      <option key={scheme} value={scheme}>
                        {scheme}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="detail-field">
                  <span>Priority</span>
                  <select name="priority" defaultValue={selectedTicket.priority} required>
                    <option value="P1">P1 — Critical</option>
                    <option value="P2">P2 — High</option>
                    <option value="P3">P3 — Normal</option>
                    <option value="P4">P4 — Low</option>
                  </select>
                </label>
              </div>

              <button className="primary-button detail-save-button" type="submit">
                Save details
              </button>
            </form>

            {isTicketAdmin && (
              <form
                className="admin-ticket-times-form"
                key={`${selectedTicket.id}-${selectedTicket.assignedAt ?? ''}-${resolutionTimeByTicket[selectedTicket.id] ?? selectedTicket.resolvedAt ?? ''}-${selectedTicket.status}`}
                onSubmit={handleUpdateTicketTimes}
              >
                <h3>Assignment and resolution times</h3>
                <div className="admin-ticket-times-grid">
                  <label className="detail-field">
                    <span>Assigned time</span>
                    <input
                      type="datetime-local"
                      name="assignedAt"
                      required
                      defaultValue={toLocalDateTimeInputValue(selectedTicket.assignedAt)}
                    />
                  </label>
                  <label className="detail-field">
                    <span>Resolved time</span>
                    <input
                      type="datetime-local"
                      name="resolvedAt"
                      disabled={selectedTicket.status !== 'Resolved'}
                      required={selectedTicket.status === 'Resolved'}
                      defaultValue={toLocalDateTimeInputValue(
                        resolutionTimeByTicket[selectedTicket.id] ?? selectedTicket.resolvedAt,
                      )}
                    />
                  </label>
                </div>
                <p>Changing assigned time recalculates the baseline SLA due time using ticket priority and holidays. Unrecorded older pause time is not included.</p>
                <button className="secondary-button" type="submit">Save times</button>
              </form>
            )}

            <div className="detail-dates">
              <div>
                <span>Assigned time</span>
                <strong>
                  {selectedTicket.assignedAt
                    ? formatDateTime(selectedTicket.assignedAt)
                    : '—'}
                </strong>
              </div>
              <div>
                <span>Resolved time</span>
                <strong>
                  {resolutionTimeByTicket[selectedTicket.id]
                    ? formatDateTime(resolutionTimeByTicket[selectedTicket.id])
                    : '—'}
                </strong>
              </div>
              <div>
                <span>SLA due</span>
                <strong>{selectedTicket.due}</strong>
              </div>
            </div>

            <details className="detail-history-section">
              <summary>
                Status history
                <span>{statusHistory[selectedTicket.id]?.length ?? 0}</span>
              </summary>
              {statusHistory[selectedTicket.id]?.length ? (
                <ul className="detail-history-list">
                  {statusHistory[selectedTicket.id].map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
                </ul>
              ) : (
                <p className="detail-empty-state">No status changes yet.</p>
              )}
            </details>

            <details className="detail-history-section">
              <summary>
                Assignment history
                <span>{assignmentHistoryByTicket[selectedTicket.id]?.length ?? 0}</span>
              </summary>
              {assignmentHistoryByTicket[selectedTicket.id]?.length ? (
                <ul className="detail-history-list">
                  {assignmentHistoryByTicket[selectedTicket.id].map(
                    (assignment, index) => <li key={index}>{assignment}</li>,
                  )}
                </ul>
              ) : (
                <p className="detail-empty-state">No assignment history yet.</p>
              )}
            </details>

            <details className="detail-history-section">
              <summary>
                Remarks
                <span>{remarksByTicket[selectedTicket.id]?.length ?? 0}</span>
              </summary>
              {remarksByTicket[selectedTicket.id]?.length ? (
                <ul className="detail-history-list">
                  {remarksByTicket[selectedTicket.id].map((remark, index) => (
                    <li key={index}>{remark}</li>
                  ))}
                </ul>
              ) : (
                <p className="detail-empty-state">No remarks yet.</p>
              )}
              <textarea
                className="detail-remark-input"
                value={newRemark}
                onChange={(event) => setNewRemark(event.target.value)}
                placeholder="Add context or an update…"
                rows={3}
              />
              <button
                className="secondary-button detail-remark-button"
                type="button"
                onClick={() => void handleAddRemark()}
              >
                Add remark
              </button>
            </details>
          </aside>
        </div>
      )}

      {slaReviewTicket && (
        <div
          className="ticket-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingSlaReview) {
              setSlaReviewTicket(null)
            }
          }}
        >
          <form
            className="ticket-create-modal sla-review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sla-review-title"
            onSubmit={handleSaveSlaReview}
          >
            <div className="create-modal-header">
              <div className="create-modal-icon" aria-hidden="true">✓</div>
              <div>
                <p className="eyebrow">Billing review</p>
                <h2 id="sla-review-title">Review SLA</h2>
                <p>The original SLA result stays unchanged. This reviewed result is tracked separately.</p>
              </div>
              <button
                className="icon-close-button"
                type="button"
                aria-label="Close SLA review"
                disabled={isSavingSlaReview}
                onClick={() => setSlaReviewTicket(null)}
              >
                ×
              </button>
            </div>

            <div className="sla-review-context">
              <div><span>Ticket</span><strong>{slaReviewTicket.id}</strong></div>
              <div><span>Calculated SLA</span><strong>{getSlaStatusLabel(slaReviewTicket)}</strong></div>
            </div>

            <div className="ticket-form-fields sla-review-fields">
              <label className="ticket-form-field">
                <span>Reviewed SLA</span>
                <select
                  required
                  value={slaReviewSelection}
                  onChange={(event) =>
                    setSlaReviewSelection(event.target.value as 'SLA Violated' | 'Within SLA')
                  }
                >
                  <option value="SLA Violated">SLA Violated</option>
                  <option value="Within SLA">Within SLA</option>
                </select>
              </label>
              <label className="ticket-form-field sla-review-note-field">
                <span>Remark <small>(required)</small></span>
                <textarea
                  required
                  rows={4}
                  value={slaReviewRemark}
                  onChange={(event) => setSlaReviewRemark(event.target.value)}
                  placeholder="Explain the reason for this SLA review."
                />
              </label>
            </div>

            <div className="ticket-create-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isSavingSlaReview}
                onClick={() => setSlaReviewTicket(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={isSavingSlaReview || !slaReviewRemark.trim()}
              >
                {isSavingSlaReview ? 'Saving…' : 'Save review'}
              </button>
            </div>
          </form>
        </div>
      )}

      {isImportOpen && (
        <div
          className="ticket-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isImporting) {
              setIsImportOpen(false)
            }
          }}
        >
          <section
            className="ticket-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-tickets-title"
          >
            <div className="create-modal-header">
              <div className="create-modal-icon" aria-hidden="true">⇧</div>
              <div>
                <p className="eyebrow">Ticket data</p>
                <h2 id="import-tickets-title">Import past tickets</h2>
                <p>Choose the workbook and review every row before adding anything.</p>
              </div>
              <button
                className="icon-close-button"
                type="button"
                aria-label="Close ticket import"
                disabled={isImporting}
                onClick={() => setIsImportOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="import-file-picker">
              <label htmlFor="ticket-import-file">Excel workbook</label>
              <input
                id="ticket-import-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) =>
                  void handleImportFileSelection(event.target.files?.[0])
                }
                disabled={isImporting}
              />
              <small>
                Expected columns: Ticket ID, Scheme, Developer, Priority, Resolved Time, Request Status, Assigned Time.
              </small>
              {importFileName && <span className="import-file-name">{importFileName}</span>}
            </div>

            {importError && (
              <p className="import-error" role="alert">{importError}</p>
            )}

            {importPreview.length > 0 && (
              <>
                <div className="import-summary" aria-live="polite">
                  <span><strong>{importableTicketCount}</strong> ready</span>
                  <span><strong>{importDuplicateCount}</strong> duplicate</span>
                  <span><strong>{importInvalidCount}</strong> need correction</span>
                </div>
                <p className="import-guidance">
                  Times are read as India time in 24-hour format. “Not Assigned” means unresolved. Awaiting Business Response maps to Business Pending; Closed maps to Resolved. A resolved time before assignment is allowed and flagged for review. Older pause durations are absent from this workbook, so add a note in each ticket’s Remarks if needed; historical SLA totals cannot reconstruct those pauses.
                </p>
                <div className="import-preview-table-wrap">
                  <table className="import-preview-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Ticket ID</th>
                        <th>Scheme</th>
                        <th>Developer</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Assigned time</th>
                        <th>Resolved time</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((row) => {
                        const state = row.errors.length > 0
                          ? 'error'
                          : row.duplicate
                            ? 'duplicate'
                            : row.warnings.length > 0
                              ? 'warning'
                              : 'ready'
                        const note = row.errors.length > 0
                          ? row.errors.join('; ')
                          : row.duplicate
                            ? 'Duplicate ticket ID; will be skipped'
                            : row.warnings.length > 0
                              ? row.warnings.join('; ')
                              : 'Ready to import'

                        return (
                          <tr key={`${row.rowNumber}-${row.ticketId}`}>
                            <td>{row.rowNumber}</td>
                            <td>{row.ticketId || '—'}</td>
                            <td>{row.ticket?.scheme || '—'}</td>
                            <td>{row.ticket?.developer || '—'}</td>
                            <td>{row.ticket?.priority || '—'}</td>
                            <td>
                              {row.ticket && row.ticket.status !== row.statusText
                                ? `${row.statusText} → ${row.ticket.status}`
                                : row.statusText || '—'}
                            </td>
                            <td>{row.assignedText || '—'}</td>
                            <td>{row.resolvedText || '—'}</td>
                            <td><span className={`import-row-state ${state}`}>{note}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="ticket-create-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isImporting}
                onClick={() => setIsImportOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={isImporting || importableTicketCount === 0}
                onClick={() => void handleImportTickets()}
              >
                {isImporting ? 'Importing…' : `Import ${importableTicketCount} valid row${importableTicketCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </section>
        </div>
      )}

      {isFormOpen && (
        <div
          className="ticket-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsFormOpen(false)
          }}
        >
          <form
            className="ticket-create-modal"
            onSubmit={handleCreateTicket}
          >
            <div className="create-modal-header">
              <div className="create-modal-icon" aria-hidden="true">＋</div>
              <div>
                <p className="eyebrow">New request</p>
                <h2>Create a ticket</h2>
                <p>Enter the ticket details to add it to your dashboard.</p>
              </div>
              <button
                className="icon-close-button"
                type="button"
                aria-label="Close create ticket form"
                onClick={() => setIsFormOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="ticket-form-fields">
            <label className="ticket-form-field">
              <span>Ticket ID / issue</span>
              <input
                required
                autoFocus
                value={newTicketId}
                onChange={(event) => setNewTicketId(event.target.value)}
                placeholder="For example, QA-1052"
              />
            </label>

            <label className="ticket-form-field">
              <span>Assigned time</span>
              <input
                type="datetime-local"
                required
                value={newAssignedAt}
                onChange={(event) => setNewAssignedAt(event.target.value)}
              />
            </label>

            <label className="ticket-form-field">
              <span>Priority</span>
              <select
                required
                value={newPriority}
                onChange={(event) =>
                  setNewPriority(event.target.value as Ticket['priority'] | '')
                }
              >
                <option value="" disabled>Select priority</option>
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — High</option>
                <option value="P3">P3 — Normal</option>
                <option value="P4">P4 — Low</option>
              </select>
            </label>

            <label className="ticket-form-field">
              <span>Scheme</span>
              <select
                required
                value={newScheme}
                onChange={(event) => setNewScheme(event.target.value)}
              >
                <option value="">Select a scheme</option>
                {availableSchemeOptions.map((scheme) => (
                  <option key={scheme} value={scheme}>
                    {scheme}
                  </option>
                ))}
              </select>
            </label>

            <label className="ticket-form-field">
              <span>Developer</span>
              <select
                required
                value={newDeveloper}
                onChange={(event) => setNewDeveloper(event.target.value)}
              >
                <option value="">Select a developer</option>
                {developers.map((developer) => (
                  <option key={developer.id} value={developer.name}>
                    {developer.name}
                  </option>
                ))}
              </select>
            </label>

            </div>

            <div className="ticket-create-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setIsFormOpen(false)}
              >
                Cancel
              </button>

              <button className="primary-button" type="submit">
                Create ticket
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

export default App
