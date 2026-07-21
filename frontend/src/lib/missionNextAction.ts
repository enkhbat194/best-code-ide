import type { MissionRecord, MissionTask } from './missionClient'

export type MissionNextActionKind =
  | 'owner_decision'
  | 'wait_for_writer'
  | 'define_goal'
  | 'define_done_contract'
  | 'continue_task'
  | 'unblock_task'
  | 'plan_tasks'
  | 'verify_outcome'
  | 'package_result'
  | 'resume_mission'
  | 'handoff_ready'

export interface MissionNextAction {
  kind: MissionNextActionKind
  title: string
  reason: string
  blocked: boolean
  ownerRequired: boolean
  taskId: string | null
}

const priorityRank: Record<MissionTask['priority'], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
}

function highestPriority(tasks: MissionTask[]): MissionTask | undefined {
  return [...tasks].sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || left.created_at.localeCompare(right.created_at))[0]
}

export function deriveMissionNextAction(mission: MissionRecord, now = Date.now()): MissionNextAction {
  const openDecision = mission.decisions.find((item) => item.status === 'open')
  if (openDecision) {
    return {
      kind: 'owner_decision',
      title: openDecision.title,
      reason: 'Owner шийдвэргүй үед AI дараагийн mutation эсвэл execution эхлүүлэхгүй.',
      blocked: true,
      ownerRequired: true,
      taskId: null,
    }
  }

  if (mission.writer_lease && Date.parse(mission.writer_lease.expires_at) > now) {
    return {
      kind: 'wait_for_writer',
      title: `${mission.writer_lease.holder_id} writer-ийн ажлыг дуусахыг хүлээх`,
      reason: `Нэг Mission-д нэг active writer зөвшөөрөгдөнө. Lease ${mission.writer_lease.expires_at} хүртэл хүчинтэй.`,
      blocked: true,
      ownerRequired: false,
      taskId: null,
    }
  }

  if (mission.lifecycle === 'paused' || mission.lifecycle === 'failed') {
    return {
      kind: 'resume_mission',
      title: 'Mission-ийг сэргээх нөхцөл, хамгийн сүүлийн алдааг шалгах',
      reason: `${mission.lifecycle} төлөвөөс шууд execution үргэлжлүүлэхгүй; current context-ийг баталгаажуулна.`,
      blocked: false,
      ownerRequired: mission.lifecycle === 'failed',
      taskId: null,
    }
  }

  if (mission.goals.length === 0) {
    return {
      kind: 'define_goal',
      title: 'Owner-ийн хүссэн бодит үр дүнг Goal болгон батлах',
      reason: 'Goal байхгүй Mission дээр task төлөвлөх нь буруу зорилго руу ажиллах эрсдэлтэй.',
      blocked: false,
      ownerRequired: true,
      taskId: null,
    }
  }

  if (mission.acceptance_criteria.length === 0) {
    return {
      kind: 'define_done_contract',
      title: 'Дууссан гэж тооцох хэмжигдэхүйц шалгууруудыг батлах',
      reason: 'Done contract байхгүй үед completion-ийг нотлох боломжгүй.',
      blocked: false,
      ownerRequired: true,
      taskId: null,
    }
  }

  const running = highestPriority(mission.tasks.filter((task) => ['running', 'waiting'].includes(task.status)))
  if (running) {
    return {
      kind: 'continue_task',
      title: running.title,
      reason: `${running.priority} priority-тэй active task эхэлсэн тул context switch хийхээс өмнө түүнийг дуусгах эсвэл evidence-тэй зогсооно.`,
      blocked: false,
      ownerRequired: false,
      taskId: running.task_id,
    }
  }

  const blocked = highestPriority(mission.tasks.filter((task) => task.status === 'blocked'))
  if (blocked) {
    return {
      kind: 'unblock_task',
      title: `${blocked.title} — blocker-ийг тодруулах`,
      reason: 'Blocked task нь downstream dependency-г зогсоож болзошгүй тул шинэ task эхлэхээс өмнө blocker-ийг шийднэ.',
      blocked: true,
      ownerRequired: false,
      taskId: blocked.task_id,
    }
  }

  const completedIds = new Set(mission.tasks.filter((task) => task.status === 'completed').map((task) => task.task_id))
  const ready = highestPriority(mission.tasks.filter((task) => ['pending', 'ready'].includes(task.status) && task.dependency_ids.every((id) => completedIds.has(id))))
  if (ready) {
    return {
      kind: 'continue_task',
      title: ready.title,
      reason: `${ready.priority} priority-тэй бөгөөд бүх dependency дууссан хамгийн үнэ цэнтэй task.`,
      blocked: false,
      ownerRequired: false,
      taskId: ready.task_id,
    }
  }

  if (mission.tasks.length === 0 && ['planned', 'framing', 'captured'].includes(mission.lifecycle)) {
    return {
      kind: 'plan_tasks',
      title: 'Done contract-ийг биелүүлэх хамгийн бага task graph үүсгэх',
      reason: 'Goal болон criteria батлагдсан боловч хэрэгжүүлэх task хараахан байхгүй.',
      blocked: false,
      ownerRequired: false,
      taskId: null,
    }
  }

  if (mission.lifecycle === 'verifying' || mission.tasks.every((task) => ['completed', 'cancelled'].includes(task.status))) {
    const pendingCriteria = mission.acceptance_criteria.filter((criterion) => criterion.status === 'pending')
    if (pendingCriteria.length > 0) {
      return {
        kind: 'verify_outcome',
        title: `${pendingCriteria.length} acceptance criterion-д evidence цуглуулах`,
        reason: 'Task дууссан нь owner outcome батлагдсан гэсэн үг биш; criterion бүр evidence шаарддаг.',
        blocked: false,
        ownerRequired: false,
        taskId: null,
      }
    }
  }

  if (mission.lifecycle === 'completed') {
    return {
      kind: 'package_result',
      title: 'Үр дүн, evidence болон Context Packet-ийг багцлах',
      reason: 'Completed Mission-ийг дахин ашиглахын тулд provider-neutral handoff болон export үүсгэнэ.',
      blocked: false,
      ownerRequired: false,
      taskId: null,
    }
  }

  return {
    kind: 'handoff_ready',
    title: 'Current Context Packet-аас дараагийн agent үргэлжлүүлэх',
    reason: 'Owner decision, active writer эсвэл unresolved dependency одоогоор ажил зогсоохгүй байна.',
    blocked: false,
    ownerRequired: false,
    taskId: null,
  }
}
