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
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [holidayDates, setHolidayDates] = useState<string[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newHolidayDate, setNewHolidayDate] = useState('')
const [newHolidayName, setNewHolidayName] = useState('')
const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null)
  const [resolvedTodayCount, setResolvedTodayCount] = useState(0)
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

  async function loadResolvedTodayCount() {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from('ticket_status_history')
      .select('ticket_id')
      .eq('to_status', 'Resolved')
      .gte('changed_at', startOfToday.toISOString())

    if (error) {
      console.error('Could not load resolved ticket count:', error.message)
      return
    }

    if (!cancelled) {
      const uniqueTicketIds = new Set((data ?? []).map((row) => row.ticket_id))
      setResolvedTodayCount(uniqueTicketIds.size)
    }
  }

  void loadResolvedTodayCount()

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

  const filteredTickets = tickets.filter((ticket) => {
    const search = searchTerm.toLowerCase()

    const matchesSearch =
      ticket.id.toLowerCase().includes(search) ||
      ticket.title.toLowerCase().includes(search) ||
      ticket.scheme.toLowerCase().includes(search) ||
      ticket.developer.toLowerCase().includes(search) ||
      ticket.priority.toLowerCase().includes(search) ||
      ticket.status.toLowerCase().includes(search)

    const matchesStatus =
      statusFilter === 'All' || ticket.status === statusFilter

    const matchesPriority =
      priorityFilter === 'All' || ticket.priority === priorityFilter

    return matchesSearch && matchesStatus && matchesPriority
  })

const breachedCount = tickets.filter((ticket) => {
  const isPaused =
    ticket.status === 'On Hold' || ticket.status === 'Business Pending'
  const isResolved = ticket.status === 'Resolved'
  const dueTime = ticket.slaDueAt
    ? new Date(ticket.slaDueAt).getTime()
    : null

  return !isPaused && !isResolved && dueTime !== null && dueTime < currentTime
}).length

const atRiskDeadline = addBusinessHours(
  new Date(currentTime),
  1,
  holidayDates,
).getTime()

const atRiskCount = tickets.filter((ticket) => {
  const isPaused =
    ticket.status === 'On Hold' || ticket.status === 'Business Pending'
  const isResolved = ticket.status === 'Resolved'
  const dueTime = ticket.slaDueAt
    ? new Date(ticket.slaDueAt).getTime()
    : null

  return (
    !isPaused &&
    !isResolved &&
    dueTime !== null &&
    dueTime > currentTime &&
    dueTime <= atRiskDeadline
  )
}).length

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
  } = {
    status: newStatus,
  }

  let nextSlaDueAt: Date | null = null

  if (newStatus === 'On Hold' && previousStatus !== 'On Hold') {
    updates.on_hold_started_at = now.toISOString()
  }

  if (previousStatus === 'On Hold' && newStatus !== 'On Hold') {
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
        <div>
          <p className="eyebrow">QUALITY OPERATIONS</p>
          <h1>Ticket dashboard</h1>
        </div>

        <button
          className="primary-button"
          type="button"
          onClick={() => setIsFormOpen(true)}
        >
          ＋ New ticket
        </button>

        <button
          type="button"
          onClick={async () => {
            const { error } = await supabase.auth.signOut()
            if (error) alert(`Could not sign out: ${error.message}`)
          }}
        >
          Sign out
        </button>
      </header>

      <section className="summary" aria-label="Ticket summary">
        <article className="summary-card">
          <span>Open tickets</span>
          <strong>
           {tickets.filter((ticket) => ticket.status !== 'Resolved').length}
          </strong>
          <small>Across all schemes</small>
        </article>

        <article className="summary-card">
          <span>At risk</span>
         <strong>{atRiskCount}</strong>
          <small>Approaching SLA</small>
        </article>

        <article className="summary-card">
          <span>Breached</span>
         <strong>{breachedCount}</strong>
          <small>Needs attention</small>
        </article>

        <article className="summary-card">
          <span>Resolved today</span>
          <strong>{resolvedTodayCount}</strong>
          <small>Since 12:00 AM</small>
        </article>
      </section>

      {session.user.email?.toLowerCase() === 'ncgtc.support@infoneo.in' && (
  <section className="ticket-section" style={{ marginBottom: '24px' }}>
    <div className="section-heading">

      <div>
        <h2>Holiday calendar</h2>
        <p>Holidays listed here are excluded from SLA calculations.</p>
      </div>
    </div>
<form
  onSubmit={handleAddHoliday}
  style={{
    display: 'flex',
    alignItems: 'end',
    gap: '12px',
    flexWrap: 'wrap',
    padding: '0 24px 16px',
  }}
>
  <label style={{ display: 'grid', gap: '6px' }}>
    Holiday date
    <input
      type="date"
      required
      value={newHolidayDate}
      onChange={(event) => setNewHolidayDate(event.target.value)}
    />
  </label>

  <label style={{ display: 'grid', gap: '6px' }}>
    Holiday name
    <input
      required
      value={newHolidayName}
      onChange={(event) => setNewHolidayName(event.target.value)}
      placeholder="For example, Republic Day"
    />
  </label>

  <button className="primary-button" type="submit">
    <button className="primary-button" type="submit">
      {editingHolidayId && (
  <button
    type="button"
    onClick={() => {
      setEditingHolidayId(null)
      setNewHolidayDate('')
      setNewHolidayName('')
    }}
  >
    Cancel edit
  </button>
)}
  {editingHolidayId ? 'Save changes' : 'Add holiday'}
</button>
  </button>
</form>

    {holidays.length > 0 ? (
      <ul>
        {holidays.map((holiday) => (
         <li
  key={holiday.id}
  style={{
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  }}
>
  <span>
    {holiday.holiday_date.split('-').reverse().join('/')} —{' '}
    {holiday.holiday_name}
  </span>

  <button
    type="button"
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
    onClick={() => void handleDeleteHoliday(holiday)}
  >
    Delete
  </button>
</li>
        ))}
      </ul>
    ) : (
      <p>No holidays added yet.</p>
    )}
  </section>
)}

      <section className="ticket-section">
        <div className="section-heading">
          <div>
            <h2>Tickets</h2>
            <p>Track assignments and service-level targets.</p>
          </div>

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

          <input
            aria-label="Search tickets"
            placeholder="Search tickets…"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

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
                  <td>
                    <span className="status">{ticket.status}</span>
                  </td>
                  <td>{ticket.scheme || '—'}</td>
                  <td>{ticket.developer || '—'}</td>
                  <td>
                    {ticket.assignedAt
                      ? formatDateTime(ticket.assignedAt)
                      : '—'}
                  </td>
                  <td>{ticket.due}</td>
                </tr>
              ))}

              {filteredTickets.length === 0 && (
                <tr>
                  <td colSpan={8}>No tickets match your search.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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