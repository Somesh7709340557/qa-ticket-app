import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import Auth from './Auth'
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
}

type Holiday = {
  id: string
  holiday_date: string
  holiday_name: string
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

function App() {
  
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
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
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<Ticket['priority']>('P3')
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
  const [dashboardMetricSelection, setDashboardMetricSelection] =
    useState<DashboardMetricSelection>(null)
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [holidayDates, setHolidayDates] = useState<string[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newHolidayDate, setNewHolidayDate] = useState('')
const [newHolidayName, setNewHolidayName] = useState('')
const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null)
  const [resolutionTimeByTicket, setResolutionTimeByTicket] =
  useState<Record<string, string>>({})
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
    const { data, error } = await supabase
      .from('ticket_status_history')
      .select('ticket_id, changed_at')
      .eq('to_status', 'Resolved')
      .order('changed_at', { ascending: false })

    if (error) {
      console.error('Could not load ticket resolution times:', error.message)
      return
    }

    if (cancelled) return

    const latestResolutionByTicket: Record<string, string> = {}

    for (const row of data ?? []) {
      if (!latestResolutionByTicket[row.ticket_id]) {
        latestResolutionByTicket[row.ticket_id] = row.changed_at
      }
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
  'id, title, priority, status, scheme, developer, assigned_at, created_at, sla_due_at, on_hold_started_at',
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
    const matchesAssignedDate = dashboardMetricSelection?.period === 'today'
      ? isAssignedToday(ticket)
      : isAssignedDateInFilter(ticket.assignedAt, assignedDateFilter)
    const matchesSelectedMetric =
      !dashboardMetricSelection || matchesMetric(ticket, dashboardMetricSelection.key)

    return matchesSearch && matchesStatus && matchesPriority &&
      matchesScheme && matchesDeveloper && matchesAssignedDate && matchesSelectedMetric
  })

  function renderMetricPanel(
    period: DashboardMetricPeriod,
    title: string,
    counts: DashboardMetricCounts,
  ) {
    return (
      <section className="metric-panel" aria-label={title}>
        <h2>{title}</h2>
        <div className="metric-list">
          {dashboardMetricDefinitions.map((metric) => {
            const selected =
              dashboardMetricSelection?.period === period &&
              dashboardMetricSelection.key === metric.key

            return (
              <button
                key={metric.key}
                type="button"
                className={`metric-button${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() =>
                  setDashboardMetricSelection((current) =>
                    current?.period === period && current.key === metric.key
                      ? null
                      : { period, key: metric.key },
                  )
                }
              >
                <span>{metric.label}</span>
                <strong>{counts[metric.key]}</strong>
              </button>
            )
          })}
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

  async function handleCreateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

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

    const highestNumber = Math.max(
      1041,
      ...tickets.map((ticket) => Number(ticket.id.replace('QA-', ''))),
    )

    const { data, error } = await supabase
      .from('tickets')
      .insert({
        id: `QA-${highestNumber + 1}`,
        title: newTitle.trim(),
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
    setNewTitle('')
    setNewPriority('P3')
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
    } = { status: newStatus }

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

  const formData = new FormData(event.currentTarget)
  const title = String(formData.get('title') ?? '').trim()
  const scheme = String(formData.get('scheme') ?? '')
  const priority = String(
  formData.get('priority') ?? selectedTicket.priority
) as Ticket['priority']

  if (!title) {
    alert('Please enter an issue title.')
    return
  }

  const { error } = await supabase
    .from('tickets')
.update({
  title,
  scheme,
  priority,
})
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
}

  if (authLoading) {
    return <p>Loading…</p>
  }

  if (!session) {
    return <Auth />
  }

  return (
    <main className="app">
     <header className="topbar">
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
      setIsFormOpen(true)
    }}
  >
    ＋ New ticket
  </button>

  <div>
    <p className="eyebrow">QUALITY OPERATIONS</p>
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
          {renderMetricPanel('today', "Today's count", todayMetricCounts)}
          {renderMetricPanel('overall', 'Overall ticket count', overallMetricCounts)}
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
                {schemeOptions.map((scheme) => (
                  <option key={scheme} value={scheme}>{scheme}</option>
                ))}
              </select>
              <select
                value={developerFilter}
                onChange={(event) => setDeveloperFilter(event.target.value)}
                aria-label="Filter by developer"
              >
                <option value="All">All developers</option>
                {developerOptions.map((developer) => (
                  <option key={developer} value={developer}>{developer}</option>
                ))}
              </select>
              <input
                aria-label="Search tickets"
                placeholder="Search tickets…"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>

          {(dashboardMetricSelection || searchTerm || statusFilter !== 'All' ||
            priorityFilter !== 'All' || schemeFilter !== 'All' ||
            developerFilter !== 'All') && (
            <div className="active-filter-row">
              <span>{filteredTickets.length} matching ticket{filteredTickets.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={clearDashboardFilters}>Clear filters</button>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Issue</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Scheme</th>
                  <th>Developer</th>
                  <th>Assigned time</th>
                  <th>SLA due</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => setSelectedTicket(ticket)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="ticket-id">{ticket.id}</td>
                    <td>{ticket.title}</td>
                    <td>
                      <span className={`priority ${ticket.priority.toLowerCase()}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td><span className="status">{ticket.status}</span></td>
                    <td>{ticket.scheme || '—'}</td>
                    <td>{ticket.developer || '—'}</td>
                    <td>{ticket.assignedAt ? formatDateTime(ticket.assignedAt) : '—'}</td>
                    <td>{ticket.due}</td>
                  </tr>
                ))}
                {filteredTickets.length === 0 && (
                  <tr><td colSpan={8}>No tickets match the selected filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="dashboard-right">
          <section className="date-filter-panel">
            <h2>Filter by assigned date</h2>
            <div className="date-filter-list">
              {assignedDateOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`date-filter-button${assignedDateFilter === option.value ? ' selected' : ''}`}
                  aria-pressed={assignedDateFilter === option.value}
                  onClick={() => {
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

          {session.user.email?.toLowerCase() === 'ncgtc.support@infoneo.in' && (
            <section className="holiday-panel">
              <h2>Holiday calendar</h2>
              <p>Holidays are excluded from SLA calculations.</p>
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

              {holidays.length > 0 ? (
                <ul className="holiday-list">
                  {holidays.map((holiday) => (
                    <li key={holiday.id}>
                      <span>
                        {holiday.holiday_date.split('-').reverse().join('/')} — {holiday.holiday_name}
                      </span>
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
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-holidays">No holidays added yet.</p>
              )}
            </section>
          )}
        </aside>
      </div>

      {selectedTicket && (
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="ticket-detail-title"
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: 'min(420px, 100%)',
            height: '100vh',
            overflowY: 'auto',
            padding: '28px',
            background: 'white',
            color: '#172033',
            boxShadow: '-12px 0 40px rgba(15, 23, 42, 0.18)',
            zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedTicket(null)}
            style={{ float: 'right', padding: '8px 12px', cursor: 'pointer' }}
          >
            Close
          </button>

          <p className="eyebrow">{selectedTicket.id}</p>
          <h2 id="ticket-detail-title">{selectedTicket.title}</h2>

          <p>
            <strong>Priority:</strong> {selectedTicket.priority}
          </p>

          <label style={{ display: 'grid', gap: '6px', margin: '16px 0' }}>
            <strong>Status</strong>
            <select
              value={selectedTicket.status}
              onChange={(event) =>
                void handleStatusChange(
                  event.target.value as Ticket['status'],
                )
              }
            >
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="On Hold">On Hold</option>
              <option value="Business Pending">Business Pending</option>
              <option value="Resolved">Resolved</option>
            </select>
          </label>

          <form
  key={selectedTicket.id}
  onSubmit={handleUpdateTicketDetails}
  style={{ display: 'grid', gap: '10px', margin: '16px 0' }}
>
  <label style={{ display: 'grid', gap: '6px' }}>
    Issue title
    <input
      name="title"
      required
      defaultValue={selectedTicket.title}
    />
  </label>

  <label style={{ display: 'grid', gap: '6px' }}>
    Scheme
    <select name="scheme" defaultValue={selectedTicket.scheme}>
      <option value="">Select a scheme</option>
      {schemeOptions.map((scheme) => (
        <option key={scheme} value={scheme}>
          {scheme}
        </option>
      ))}
    </select>
  </label>

  <label>
  Priority
  <select name="priority" defaultValue={selectedTicket.priority} required>
    <option value="P1">P1</option>
    <option value="P2">P2</option>
    <option value="P3">P3</option>
    <option value="P4">P4</option>
  </select>
</label>

  <button type="submit">Save details</button>
</form>
          <p>
           <label style={{ display: 'grid', gap: '6px', margin: '16px 0' }}>
  <strong>Developer</strong>
  <select
    value={selectedTicket.developer}
    onChange={(event) => void handleDeveloperChange(event.target.value)}
  >
    <option value="">Select a developer</option>
    {developerOptions.map((developer) => (
      <option key={developer} value={developer}>
        {developer}
      </option>
    ))}
  </select>
  
</label>
          </p>
          <p>
            <strong>Assigned time:</strong>{' '}
            {selectedTicket.assignedAt
              ? formatDateTime(selectedTicket.assignedAt)
              : '—'}
          </p>
          <p>
            <strong>SLA due:</strong> {selectedTicket.due}
          </p>

          <h3>Status history</h3>

          {statusHistory[selectedTicket.id]?.length ? (
            <ul>
              {statusHistory[selectedTicket.id].map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          ) : (
            <p>No status changes yet.</p>
          )}

          <h3>Assignment history</h3>

          {assignmentHistoryByTicket[selectedTicket.id]?.length ? (
            <ul>
              {assignmentHistoryByTicket[selectedTicket.id].map(
                (assignment, index) => (
                  <li key={index}>{assignment}</li>
                ),
              )}
            </ul>
          ) : (
            <p>No assignment history yet.</p>
          )}

          <h3>Remarks</h3>

          {remarksByTicket[selectedTicket.id]?.length ? (
            <ul>
              {remarksByTicket[selectedTicket.id].map((remark, index) => (
                <li key={index}>{remark}</li>
              ))}
            </ul>
          ) : (
            <p>No remarks yet.</p>
          )}

          <textarea
            value={newRemark}
            onChange={(event) => setNewRemark(event.target.value)}
            placeholder="Write a remark…"
            rows={3}
            style={{ width: '100%', marginTop: '12px' }}
          />

          <button
            type="button"
            onClick={() => void handleAddRemark()}
            style={{ marginTop: '8px', padding: '10px 14px', cursor: 'pointer' }}
          >
            Add remark
          </button>
        </aside>
      )}

      {isFormOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10,
            display: 'grid',
            placeItems: 'center',
            padding: '20px',
            background: 'rgba(15, 23, 42, 0.5)',
          }}
        >
          <form
            onSubmit={handleCreateTicket}
            style={{
              display: 'grid',
              gap: '16px',
              width: '100%',
              maxWidth: '440px',
              padding: '24px',
              borderRadius: '12px',
              background: 'white',
              color: '#172033',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.2)',
            }}
          >
            <div>
              <h2 style={{ margin: '0 0 6px' }}>Create a ticket</h2>
              <p style={{ margin: 0, color: '#64748b' }}>
                Add the issue, priority, scheme, and developer.
              </p>
            </div>

            <label style={{ display: 'grid', gap: '6px' }}>
              Issue title
              <input
                required
                autoFocus
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Describe the issue"
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              Assigned time
              <input
                type="datetime-local"
                required
                value={newAssignedAt}
                onChange={(event) => setNewAssignedAt(event.target.value)}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              Priority
              <select
                value={newPriority}
                onChange={(event) =>
                  setNewPriority(event.target.value as Ticket['priority'])
                }
              >
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — High</option>
                <option value="P3">P3 — Normal</option>
                <option value="P4">P4 — Low</option>
              </select>
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              Scheme
              <select
                required
                value={newScheme}
                onChange={(event) => setNewScheme(event.target.value)}
              >
                <option value="">Select a scheme</option>
                {schemeOptions.map((scheme) => (
                  <option key={scheme} value={scheme}>
                    {scheme}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              Developer
              <select
                required
                value={newDeveloper}
                onChange={(event) => setNewDeveloper(event.target.value)}
              >
                <option value="">Select a developer</option>
                {developerOptions.map((developer) => (
                  <option key={developer} value={developer}>
                    {developer}
                  </option>
                ))}
              </select>
            </label>

            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
            >
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                style={{
                  padding: '10px 14px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '7px',
                  background: 'white',
                  cursor: 'pointer',
                }}
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
