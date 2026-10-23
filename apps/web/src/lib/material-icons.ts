import {
  FileText,
  FileType,
  Image as ImageIcon,
  MonitorPlay,
  Music,
  NotebookPen,
  Presentation,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { MaterialType } from '@campuslink/shared';

/** One icon per kind of study material (library cards, assistant results). */
export const MATERIAL_ICONS: Record<MaterialType, LucideIcon> = {
  pdf: FileText,
  doc: FileType,
  slides: Presentation,
  notes: NotebookPen,
  image: ImageIcon,
  video_file: Video,
  video_link: MonitorPlay,
  audio: Music,
};
