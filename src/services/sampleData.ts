import type { ContactProfile, ReminderItem } from '../types/reminder';

const SAMPLE_SEEDED_KEY = 'oopsie_sample_seeded_v1';

export function hasSeededSampleData(): boolean {
  try {
    return localStorage.getItem(SAMPLE_SEEDED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markSampleDataSeeded(): void {
  try {
    localStorage.setItem(SAMPLE_SEEDED_KEY, 'true');
  } catch {
    // Ignore storage quota errors
  }
}

export function getSampleContacts(): ContactProfile[] {
  return [
    {
      key: 'rahul',
      name: 'Rahul',
      role: 'Procurement Lead',
      company: 'Vertex Logistics',
      email: 'rahul.verma@vertexlogistics.io',
      phone: '+1 (415) 555-0148',
      notes: 'Usually sends finalized vendor quotes by mid-afternoon.',
      commitments: ['Send revised Q4 quotation with bulk discount by Friday'],
    },
    {
      key: 'priya nair',
      name: 'Priya Nair',
      role: 'Product Designer',
      company: 'Studio North',
      email: 'priya@studionorth.co',
      phone: '+1 (415) 555-0192',
      notes: 'Prefers async Figma review links before Thursday standups.',
      commitments: ['Share updated onboarding prototype and icon exports'],
    },
    {
      key: 'anil sharma',
      name: 'Anil Sharma',
      role: 'Account Executive',
      company: 'CloudBridge',
      email: 'anil@cloudbridge.com',
      phone: '+1 (650) 555-0174',
      notes: 'Waiting on signed renewal addendum from legal.',
      commitments: ['Confirm enterprise renewal pricing tier'],
    },
    {
      key: 'maya chen',
      name: 'Maya Chen',
      role: 'Operations Director',
      company: 'Harbor Health',
      email: 'maya.chen@harborhealth.org',
      notes: 'Quarterly planning partner.',
      commitments: ['Send agenda slides 24 hours ahead of kickoff'],
    },
    {
      key: 'david brooks',
      name: 'David Brooks',
      role: 'Finance Controller',
      company: 'Northstar Advisory',
      email: 'dbrooks@northstar.co',
      commitments: ['Approve Q3 reimbursement batch'],
    },
  ];
}

export function getSampleReminders(now = new Date()): ReminderItem[] {
  const relIso = (daysOffset: number, hour: number, minute = 0): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysOffset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  const todayHourIso = (hoursFromNow: number): string => {
    const d = new Date(now.getTime() + hoursFromNow * 3600000);
    d.setSeconds(0, 0);
    return d.toISOString();
  };

  return [
    {
      id: 'sample-rahul-quotation',
      title: 'Follow up with Rahul on revised Q4 quotation',
      person: 'Rahul',
      project: 'Q4 Vendor Renewal',
      category: 'Work',
      priority: 'high',
      dueAt: todayHourIso(2),
      status: 'waiting',
      followUpRule: {
        enabled: true,
        intervalDays: 2,
        description: 'Condition: Follow up if Rahul has not sent the revised PDF before end of day',
      },
      snoozeCount: 1,
      lastNotifiedAt: null,
      lastActivityAt: relIso(-1, 16, 15),
      createdAt: relIso(-3, 10, 0),
      closedAt: null,
      timeline: [
        {
          id: 'tl-rahul-1',
          type: 'created',
          text: 'Requested updated Q4 quotation with bulk pricing.',
          timestamp: relIso(-3, 10, 0),
        },
        {
          id: 'tl-rahul-2',
          type: 'user_update',
          text: 'Rahul promised to send the revised sheet after checking with finance.',
          timestamp: relIso(-2, 14, 30),
        },
        {
          id: 'tl-rahul-3',
          type: 'reminded',
          text: 'Follow-up reminder triggered.',
          timestamp: relIso(-1, 11, 0),
        },
        {
          id: 'tl-rahul-4',
          type: 'user_update',
          text: 'Rahul requested one more day while waiting on shipping rates.',
          timestamp: relIso(-1, 16, 15),
        },
        {
          id: 'tl-rahul-5',
          type: 'rescheduled',
          text: 'New follow-up scheduled for today.',
          timestamp: relIso(-1, 16, 16),
        },
      ],
    },
    {
      id: 'sample-anil-invoice',
      title: 'Check with Anil Sharma on signed renewal addendum',
      person: 'Anil Sharma',
      project: 'CloudBridge Renewal',
      category: 'Finance',
      priority: 'high',
      dueAt: relIso(-2, 11, 0),
      status: 'waiting',
      followUpRule: {
        enabled: true,
        intervalDays: 3,
        description: 'Condition: Check again if legal approval is still pending',
      },
      snoozeCount: 2,
      lastNotifiedAt: relIso(-2, 11, 5),
      lastActivityAt: relIso(-4, 15, 20),
      createdAt: relIso(-6, 9, 30),
      closedAt: null,
      timeline: [
        {
          id: 'tl-anil-1',
          type: 'created',
          text: 'Sent annual contract renewal terms to Anil.',
          timestamp: relIso(-6, 9, 30),
        },
        {
          id: 'tl-anil-2',
          type: 'user_update',
          text: 'Anil confirmed legal team is reviewing clause 4 and would reply this week.',
          timestamp: relIso(-4, 15, 20),
        },
      ],
    },
    {
      id: 'sample-priya-design',
      title: 'Review onboarding prototype and icon specs with Priya Nair',
      person: 'Priya Nair',
      project: 'Mobile Refresh',
      category: 'Work',
      priority: 'medium',
      dueAt: todayHourIso(4),
      status: 'needs_action',
      followUpRule: {
        enabled: true,
        intervalDays: null,
        description: 'Check in after design review session',
      },
      snoozeCount: 0,
      lastNotifiedAt: null,
      lastActivityAt: relIso(-1, 17, 45),
      createdAt: relIso(-2, 11, 0),
      closedAt: null,
      timeline: [
        {
          id: 'tl-priya-1',
          type: 'created',
          text: 'Saved from conversation: Priya shared v2 Figma link for sign-off.',
          timestamp: relIso(-2, 11, 0),
        },
        {
          id: 'tl-priya-2',
          type: 'ai_summary',
          text: 'Pending your feedback on mobile bottom navigation spacing.',
          timestamp: relIso(-1, 17, 45),
        },
      ],
    },
    {
      id: 'sample-maya-sync',
      title: 'Send quarterly kickoff agenda to Maya Chen',
      person: 'Maya Chen',
      project: 'Harbor Partnership',
      category: 'Work',
      priority: 'medium',
      dueAt: relIso(2, 10, 0),
      status: 'needs_action',
      followUpRule: {
        enabled: false,
        intervalDays: null,
        description: null,
      },
      snoozeCount: 0,
      lastNotifiedAt: null,
      lastActivityAt: relIso(-1, 9, 15),
      createdAt: relIso(-1, 9, 15),
      closedAt: null,
      timeline: [
        {
          id: 'tl-maya-1',
          type: 'created',
          text: 'Agreed to share kickoff deck 24h before Thursday call.',
          timestamp: relIso(-1, 9, 15),
        },
      ],
    },
    {
      id: 'sample-pharmacy-pickup',
      title: 'Pick up prescription & send Mom weekend travel times',
      person: null,
      project: null,
      category: 'Health',
      priority: 'medium',
      dueAt: relIso(1, 17, 30),
      status: 'needs_action',
      followUpRule: {
        enabled: false,
        intervalDays: null,
        description: null,
      },
      snoozeCount: 0,
      lastNotifiedAt: null,
      lastActivityAt: relIso(0, 8, 20),
      createdAt: relIso(0, 8, 20),
      closedAt: null,
      timeline: [
        {
          id: 'tl-health-1',
          type: 'created',
          text: 'Pharmacy closes at 7 PM; confirm train arrival with Mom.',
          timestamp: relIso(0, 8, 20),
        },
      ],
    },
    {
      id: 'sample-david-reimbursement',
      title: 'Confirm Q3 travel reimbursement approval with David Brooks',
      person: 'David Brooks',
      project: 'Finance Ops',
      category: 'Finance',
      priority: 'low',
      dueAt: relIso(-2, 15, 0),
      status: 'closed',
      followUpRule: {
        enabled: true,
        intervalDays: null,
        description: 'Check until payout clears',
      },
      snoozeCount: 0,
      lastNotifiedAt: relIso(-3, 10, 0),
      lastActivityAt: relIso(-1, 13, 10),
      createdAt: relIso(-5, 11, 20),
      closedAt: relIso(-1, 13, 10),
      timeline: [
        {
          id: 'tl-david-1',
          type: 'created',
          text: 'Submitted receipts for client workshop.',
          timestamp: relIso(-5, 11, 20),
        },
        {
          id: 'tl-david-2',
          type: 'user_update',
          text: 'David confirmed batch was queued for Friday payout.',
          timestamp: relIso(-3, 14, 0),
        },
        {
          id: 'tl-david-3',
          type: 'closed',
          text: 'Outcome recorded: Reimbursement approved and deposited.',
          timestamp: relIso(-1, 13, 10),
        },
      ],
    },
  ];
}
