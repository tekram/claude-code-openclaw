export interface TodoItem {
  text: string;
  project?: string;
  assignedTo?: string;
  taskId?: string;
  completed: boolean;
  source: 'captures';
}

export interface TodosData {
  items: TodoItem[];
  lastUpdated: string;
}
