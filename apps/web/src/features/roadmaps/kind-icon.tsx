import { BookOpen, ClipboardCheck, Flag, Hammer } from 'lucide-react';
import type { RoadmapNode } from '@campuslink/shared';

/** A step's kind as a 20 px icon (the journey's rows and the step sheet); decorative. */
export function KindIcon({ kind }: { kind: RoadmapNode['kind'] }) {
  const Icon =
    kind === 'project' ? Hammer : kind === 'exam' ? ClipboardCheck : kind === 'milestone' ? Flag : BookOpen;
  return <Icon className="size-5" aria-hidden />;
}
