import { useNavigate } from 'react-router-dom'
import type { Project } from '../../lib/types'
import ProjectCard from './ProjectCard'

interface Props {
  projects: Project[]
}

export default function ProjectGrid({ projects }: Props) {
  const navigate = useNavigate()
  return (
    <div className="projects-grid">
      {projects.map((p) => <ProjectCard key={p.siteId} project={p} />)}
      <button
        className="proj-new"
        onClick={() => navigate('/projects/new')}
        aria-label="Create new project"
      >
        <span className="proj-new-plus">+</span>
        <span className="proj-new-label">New project</span>
      </button>
    </div>
  )
}