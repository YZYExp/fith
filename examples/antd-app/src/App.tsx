import {
  Layout,
  Tree,
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Progress,
  Button,
  Space,
  Avatar,
  Typography,
  Badge,
  Steps,
  Timeline,
  Collapse,
  Form,
  Input,
  Select,
  Tooltip,
  Divider,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  FileTextOutlined,
  CodeOutlined,
  ApiOutlined,
  CloudOutlined,
  TeamOutlined,
  PlusOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  BugOutlined,
  DeploymentUnitOutlined,
  UserOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;
const { Title, Paragraph, Text } = Typography;

const treeData: DataNode[] = [
  {
    key: 'projects',
    title: 'Projects',
    icon: <FolderOpenOutlined />,
    children: [
      {
        key: 'alpha',
        title: 'Project Alpha',
        icon: <FolderOpenOutlined />,
        children: [
          {
            key: 'alpha-design',
            title: 'Design',
            icon: <FolderOpenOutlined />,
            children: [
              { key: 'alpha-design-1', title: 'wireframes.fig', icon: <FileTextOutlined /> },
              { key: 'alpha-design-2', title: 'brand-guide.pdf', icon: <FileTextOutlined /> },
              { key: 'alpha-design-3', title: 'components.sketch', icon: <FileTextOutlined /> },
              { key: 'alpha-design-4', title: 'mockup-v2.fig', icon: <FileTextOutlined /> },
              { key: 'alpha-design-5', title: 'icons.svg', icon: <FileOutlined /> },
            ],
          },
          {
            key: 'alpha-frontend',
            title: 'Frontend',
            icon: <FolderOpenOutlined />,
            children: [
              { key: 'alpha-fe-1', title: 'App.tsx', icon: <CodeOutlined /> },
              { key: 'alpha-fe-2', title: 'Dashboard.tsx', icon: <CodeOutlined /> },
              { key: 'alpha-fe-3', title: 'Settings.tsx', icon: <CodeOutlined /> },
              { key: 'alpha-fe-4', title: 'components/', icon: <FolderOutlined /> },
              { key: 'alpha-fe-5', title: 'hooks/', icon: <FolderOutlined /> },
              { key: 'alpha-fe-6', title: 'utils.ts', icon: <CodeOutlined /> },
              { key: 'alpha-fe-7', title: 'styles.css', icon: <FileOutlined /> },
            ],
          },
          {
            key: 'alpha-backend',
            title: 'Backend',
            icon: <FolderOpenOutlined />,
            children: [
              { key: 'alpha-be-1', title: 'server.ts', icon: <CodeOutlined /> },
              { key: 'alpha-be-2', title: 'routes/', icon: <FolderOutlined /> },
              { key: 'alpha-be-3', title: 'models/', icon: <FolderOutlined /> },
              { key: 'alpha-be-4', title: 'middleware/', icon: <FolderOutlined /> },
              { key: 'alpha-be-5', title: 'auth.ts', icon: <CodeOutlined /> },
              { key: 'alpha-be-6', title: 'db.ts', icon: <ApiOutlined /> },
            ],
          },
          {
            key: 'alpha-devops',
            title: 'DevOps',
            icon: <FolderOutlined />,
            children: [
              { key: 'alpha-do-1', title: 'Dockerfile', icon: <CloudOutlined /> },
              { key: 'alpha-do-2', title: 'docker-compose.yml', icon: <CloudOutlined /> },
              { key: 'alpha-do-3', title: '.github/workflows/', icon: <FolderOutlined /> },
              { key: 'alpha-do-4', title: 'terraform/', icon: <FolderOutlined /> },
            ],
          },
        ],
      },
      {
        key: 'beta',
        title: 'Project Beta',
        icon: <FolderOpenOutlined />,
        children: [
          {
            key: 'beta-research',
            title: 'Research',
            icon: <FolderOpenOutlined />,
            children: [
              { key: 'beta-r-1', title: 'market-analysis.xlsx', icon: <FileTextOutlined /> },
              { key: 'beta-r-2', title: 'user-interviews.docx', icon: <FileTextOutlined /> },
              { key: 'beta-r-3', title: 'competitive-review.pdf', icon: <FileTextOutlined /> },
              { key: 'beta-r-4', title: 'personas.fig', icon: <FileTextOutlined /> },
              { key: 'beta-r-5', title: 'survey-results.csv', icon: <FileOutlined /> },
            ],
          },
          {
            key: 'beta-dev',
            title: 'Development',
            icon: <FolderOpenOutlined />,
            children: [
              { key: 'beta-d-1', title: 'index.ts', icon: <CodeOutlined /> },
              { key: 'beta-d-2', title: 'api-client.ts', icon: <ApiOutlined /> },
              { key: 'beta-d-3', title: 'schema.graphql', icon: <CodeOutlined /> },
              { key: 'beta-d-4', title: 'resolvers.ts', icon: <CodeOutlined /> },
              { key: 'beta-d-5', title: 'migrations/', icon: <FolderOutlined /> },
              { key: 'beta-d-6', title: 'seeds/', icon: <FolderOutlined /> },
              { key: 'beta-d-7', title: 'types.d.ts', icon: <FileOutlined /> },
            ],
          },
          {
            key: 'beta-testing',
            title: 'Testing',
            icon: <FolderOpenOutlined />,
            children: [
              { key: 'beta-t-1', title: 'unit/', icon: <FolderOutlined /> },
              { key: 'beta-t-2', title: 'integration/', icon: <FolderOutlined /> },
              { key: 'beta-t-3', title: 'e2e/', icon: <FolderOutlined /> },
              { key: 'beta-t-4', title: 'jest.config.ts', icon: <CodeOutlined /> },
              { key: 'beta-t-5', title: 'cypress.config.ts', icon: <CodeOutlined /> },
              { key: 'beta-t-6', title: 'fixtures/', icon: <FolderOutlined /> },
            ],
          },
        ],
      },
      {
        key: 'gamma',
        title: 'Project Gamma',
        icon: <FolderOutlined />,
        children: [
          { key: 'gamma-1', title: 'README.md', icon: <FileTextOutlined /> },
          { key: 'gamma-2', title: 'spec.md', icon: <FileTextOutlined /> },
          { key: 'gamma-3', title: 'roadmap.md', icon: <FileTextOutlined /> },
          {
            key: 'gamma-src',
            title: 'src/',
            icon: <FolderOutlined />,
            children: [
              { key: 'gamma-src-1', title: 'main.py', icon: <CodeOutlined /> },
              { key: 'gamma-src-2', title: 'config.py', icon: <CodeOutlined /> },
              { key: 'gamma-src-3', title: 'utils.py', icon: <CodeOutlined /> },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'resources',
    title: 'Resources',
    icon: <FolderOpenOutlined />,
    children: [
      { key: 'res-1', title: 'design-tokens.json', icon: <FileOutlined /> },
      { key: 'res-2', title: 'icon-library.fig', icon: <FileTextOutlined /> },
      { key: 'res-3', title: 'brand-assets.zip', icon: <FileOutlined /> },
      { key: 'res-4', title: 'shared-components/', icon: <FolderOutlined /> },
      { key: 'res-5', title: 'coding-standards.md', icon: <FileTextOutlined /> },
      { key: 'res-6', title: 'api-docs/', icon: <FolderOutlined /> },
      { key: 'res-7', title: 'onboarding.pdf', icon: <FileTextOutlined /> },
    ],
  },
  {
    key: 'team',
    title: 'Team',
    icon: <TeamOutlined />,
    children: [
      { key: 'team-1', title: 'org-chart.fig', icon: <FileTextOutlined /> },
      { key: 'team-2', title: 'roles.md', icon: <FileTextOutlined /> },
      { key: 'team-3', title: 'meeting-notes/', icon: <FolderOutlined /> },
    ],
  },
];

const defaultExpandedKeys = [
  'projects',
  'alpha',
  'alpha-design',
  'alpha-frontend',
  'alpha-backend',
  'alpha-devops',
  'beta',
  'beta-research',
  'beta-dev',
  'beta-testing',
  'resources',
  'team',
];

interface TaskRow {
  key: string;
  task: string;
  assignee: string;
  priority: string;
  tags: string[];
  progress: number;
  due: string;
}

const tableData: TaskRow[] = [
  { key: '1', task: 'Design system audit', assignee: 'Alice Chen', priority: 'high', tags: ['design', 'ux'], progress: 85, due: '2026-05-28' },
  { key: '2', task: 'API gateway migration', assignee: 'Bob Kumar', priority: 'critical', tags: ['backend', 'infra'], progress: 42, due: '2026-06-01' },
  { key: '3', task: 'User onboarding flow', assignee: 'Carol Wu', priority: 'medium', tags: ['frontend', 'ux'], progress: 67, due: '2026-06-05' },
  { key: '4', task: 'Performance benchmarks', assignee: 'Dave Park', priority: 'low', tags: ['qa', 'perf'], progress: 20, due: '2026-06-10' },
  { key: '5', task: 'Auth service refactor', assignee: 'Eve Zhao', priority: 'high', tags: ['backend', 'security'], progress: 55, due: '2026-05-30' },
  { key: '6', task: 'Dashboard v3 release', assignee: 'Frank Lee', priority: 'critical', tags: ['frontend', 'release'], progress: 91, due: '2026-05-25' },
  { key: '7', task: 'Database indexing review', assignee: 'Grace Kim', priority: 'medium', tags: ['backend', 'db'], progress: 33, due: '2026-06-15' },
];

const priorityColor: Record<string, string> = {
  critical: 'red',
  high: 'volcano',
  medium: 'gold',
  low: 'cyan',
};

const gradientStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

const collapseItems = [
  {
    key: '1',
    label: 'Project Alpha — Q2 Overview',
    children: (
      <div>
        <Paragraph>
          Project Alpha is on track for its Q2 milestone delivery. The design system has been finalized
          and the frontend team is integrating components ahead of schedule.
        </Paragraph>
        <Space wrap>
          <Tag color="green">on-track</Tag>
          <Tag color="blue">frontend</Tag>
          <Tag color="purple">design</Tag>
          <Tag color="orange">milestone</Tag>
        </Space>
        <Divider style={{ margin: '12px 0' }} />
        <Text type="secondary">Last updated: 2026-05-20 · Owner: Alice Chen</Text>
      </div>
    ),
  },
  {
    key: '2',
    label: 'Project Beta — Research Summary',
    children: (
      <div>
        <Paragraph>
          User research revealed three critical pain points in the current checkout flow. Competitive
          analysis identified two untapped market segments worth targeting in H2.
        </Paragraph>
        <Space wrap>
          <Tag color="geekblue">research</Tag>
          <Tag color="magenta">ux</Tag>
          <Tag color="gold">insights</Tag>
        </Space>
        <Divider style={{ margin: '12px 0' }} />
        <Text type="secondary">Last updated: 2026-05-18 · Owner: Carol Wu</Text>
      </div>
    ),
  },
  {
    key: '3',
    label: 'Infrastructure — Migration Plan',
    children: (
      <div>
        <Paragraph>
          The API gateway migration from v1 to v2 is scheduled for a staged rollout. Blue-green
          deployment strategy will minimize downtime. Rollback procedures have been documented and tested.
        </Paragraph>
        <Space wrap>
          <Tag color="red">critical</Tag>
          <Tag color="cyan">infra</Tag>
          <Tag color="blue">devops</Tag>
          <Tag color="volcano">migration</Tag>
        </Space>
        <Divider style={{ margin: '12px 0' }} />
        <Text type="secondary">Last updated: 2026-05-22 · Owner: Bob Kumar</Text>
      </div>
    ),
  },
  {
    key: '4',
    label: 'Security — Quarterly Review',
    children: (
      <div>
        <Paragraph>
          All high-severity vulnerabilities from the last pen-test have been resolved. Auth service
          is being refactored to support OAuth 2.1 and PKCE flows. SOC 2 Type II audit preparation
          is underway.
        </Paragraph>
        <Space wrap>
          <Tag color="red">security</Tag>
          <Tag color="green">resolved</Tag>
          <Tag color="geekblue">compliance</Tag>
          <Tag color="purple">auth</Tag>
        </Space>
        <Divider style={{ margin: '12px 0' }} />
        <Text type="secondary">Last updated: 2026-05-21 · Owner: Eve Zhao</Text>
      </div>
    ),
  },
];

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Sider
        width={260}
        theme="dark"
        style={{ overflowY: 'auto', height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0 }}
      >
        <div
          style={{
            padding: '20px 16px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ThunderboltOutlined style={{ color: '#fff', fontSize: 16 }} />
          </div>
          <Title level={4} style={{ margin: 0, ...gradientStyle, fontWeight: 800, letterSpacing: -0.5 }}>
            WorkFlow
          </Title>
        </div>
        <div style={{ padding: '8px 4px' }}>
          <Tree
            treeData={treeData}
            defaultExpandedKeys={defaultExpandedKeys}
            showIcon
            theme="dark"
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.85)', fontSize: 13 }}
          />
        </div>
      </Sider>

      <Layout style={{ marginLeft: 260 }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Title
              level={4}
              style={{ margin: 0, fontWeight: 800, letterSpacing: -0.5, ...gradientStyle }}
            >
              WorkFlow
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Project Management
            </Text>
          </div>
          <Space size={12}>
            <Button icon={<PlusOutlined />} type="primary" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', border: 'none' }}>
              New Task
            </Button>
            <Tooltip title="Bob Kumar">
              <Badge count={3} size="small">
                <Avatar style={{ background: '#f5576c' }} icon={<UserOutlined />} />
              </Badge>
            </Tooltip>
          </Space>
        </Header>

        <Content style={{ padding: 24 }}>
          <Row gutter={[16, 16]}>
            <Col span={6}>
              <Card bordered={false} style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <Statistic
                  title="Active Tasks"
                  value={147}
                  prefix={<RocketOutlined style={{ color: '#f5576c' }} />}
                  valueStyle={{ color: '#f5576c', fontWeight: 700 }}
                />
                <Progress percent={68} showInfo={false} strokeColor="#f5576c" size="small" style={{ marginTop: 8 }} />
                <Text type="secondary" style={{ fontSize: 12 }}>68% sprint capacity</Text>
              </Card>
            </Col>
            <Col span={6}>
              <Card bordered={false} style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <Statistic
                  title="Completed"
                  value={389}
                  prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  valueStyle={{ color: '#52c41a', fontWeight: 700 }}
                />
                <Space style={{ marginTop: 8 }}>
                  <ArrowUpOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>+24 this week</Text>
                </Space>
              </Card>
            </Col>
            <Col span={6}>
              <Card bordered={false} style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <Statistic
                  title="Overdue"
                  value={8}
                  prefix={<ClockCircleOutlined style={{ color: '#ff4d4f' }} />}
                  valueStyle={{ color: '#ff4d4f', fontWeight: 700 }}
                />
                <Space style={{ marginTop: 8 }}>
                  <ArrowDownOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>-3 vs last week</Text>
                </Space>
              </Card>
            </Col>
            <Col span={6}>
              <Card bordered={false} style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <Statistic
                  title="Open Bugs"
                  value={23}
                  prefix={<BugOutlined style={{ color: '#faad14' }} />}
                  valueStyle={{ color: '#faad14', fontWeight: 700 }}
                />
                <Progress percent={38} showInfo={false} strokeColor="#faad14" size="small" style={{ marginTop: 8 }} />
                <Text type="secondary" style={{ fontSize: 12 }}>38% resolved</Text>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={24}>
              <Card
                title={<Text strong>Sprint Tasks</Text>}
                extra={
                  <Space>
                    <Select defaultValue="all" size="small" style={{ width: 110 }} options={[
                      { value: 'all', label: 'All Tasks' },
                      { value: 'mine', label: 'My Tasks' },
                      { value: 'overdue', label: 'Overdue' },
                    ]} />
                    <Button size="small" icon={<PlusOutlined />}>Add Task</Button>
                  </Space>
                }
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              >
                <Table<TaskRow>
                  dataSource={tableData}
                  pagination={false}
                  size="small"
                  columns={[
                    {
                      title: 'Task',
                      dataIndex: 'task',
                      key: 'task',
                      render: (t: string) => <Text strong>{t}</Text>,
                    },
                    {
                      title: 'Assignee',
                      dataIndex: 'assignee',
                      key: 'assignee',
                      render: (a: string) => (
                        <Space size={6}>
                          <Avatar size={22} icon={<UserOutlined />} style={{ background: '#f5576c', fontSize: 10 }} />
                          <Text style={{ fontSize: 13 }}>{a}</Text>
                        </Space>
                      ),
                    },
                    {
                      title: 'Priority',
                      dataIndex: 'priority',
                      key: 'priority',
                      render: (p: string) => <Tag color={priorityColor[p]}>{p.toUpperCase()}</Tag>,
                    },
                    {
                      title: 'Tags',
                      dataIndex: 'tags',
                      key: 'tags',
                      render: (tags: string[]) => (
                        <Space size={4} wrap>
                          {tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}
                        </Space>
                      ),
                    },
                    {
                      title: 'Progress',
                      dataIndex: 'progress',
                      key: 'progress',
                      width: 160,
                      render: (p: number) => (
                        <Space direction="vertical" size={0} style={{ width: '100%' }}>
                          <Progress
                            percent={p}
                            size="small"
                            strokeColor={p >= 80 ? '#52c41a' : p >= 50 ? '#1677ff' : '#faad14'}
                          />
                        </Space>
                      ),
                    },
                    {
                      title: 'Due',
                      dataIndex: 'due',
                      key: 'due',
                      render: (d: string) => <Text type="secondary" style={{ fontSize: 12 }}>{d}</Text>,
                    },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={8}>
              <Card
                title={<Text strong>Release Pipeline</Text>}
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              >
                <Steps
                  direction="vertical"
                  current={3}
                  size="small"
                  items={[
                    { title: 'Requirements', description: 'Specs locked', icon: <CheckCircleOutlined /> },
                    { title: 'Design', description: 'Approved by stakeholders', icon: <CheckCircleOutlined /> },
                    { title: 'Development', description: 'Code review in progress', icon: <CheckCircleOutlined /> },
                    { title: 'QA Testing', description: 'Running automated suite', icon: <ClockCircleOutlined /> },
                    { title: 'Staging Deploy', description: 'Pending QA sign-off' },
                    { title: 'Production', description: 'Scheduled 2026-05-28' },
                  ]}
                />
              </Card>
            </Col>

            <Col span={8}>
              <Card
                title={<Text strong>Activity Feed</Text>}
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              >
                <Timeline
                  items={[
                    {
                      color: 'green',
                      dot: <CheckCircleOutlined />,
                      children: (
                        <div>
                          <Text strong>Deploy succeeded</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>Dashboard v3 deployed to staging · 2m ago</Text>
                        </div>
                      ),
                    },
                    {
                      color: 'blue',
                      dot: <DeploymentUnitOutlined />,
                      children: (
                        <div>
                          <Text strong>PR merged</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>Auth refactor #482 merged by Eve · 1h ago</Text>
                        </div>
                      ),
                    },
                    {
                      color: 'red',
                      dot: <BugOutlined />,
                      children: (
                        <div>
                          <Text strong>Bug reported</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>Payment flow timeout on Safari · 2h ago</Text>
                        </div>
                      ),
                    },
                    {
                      color: 'gold',
                      dot: <ClockCircleOutlined />,
                      children: (
                        <div>
                          <Text strong>Deadline approaching</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>API gateway migration due in 3 days</Text>
                        </div>
                      ),
                    },
                    {
                      color: 'purple',
                      dot: <TeamOutlined />,
                      children: (
                        <div>
                          <Text strong>Team meeting</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>Sprint review scheduled for Friday</Text>
                        </div>
                      ),
                    },
                    {
                      color: 'cyan',
                      dot: <RocketOutlined />,
                      children: (
                        <div>
                          <Text strong>Sprint started</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>Sprint 24 kicked off with 47 tasks</Text>
                        </div>
                      ),
                    },
                  ]}
                />
              </Card>
            </Col>

            <Col span={8}>
              <Card
                title={<Text strong>Quick Add Task</Text>}
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              >
                <Form layout="vertical" size="small">
                  <Form.Item label="Task Title">
                    <Input placeholder="e.g. Review PR #512" />
                  </Form.Item>
                  <Form.Item label="Project">
                    <Select
                      placeholder="Select project"
                      options={[
                        { value: 'alpha', label: 'Project Alpha' },
                        { value: 'beta', label: 'Project Beta' },
                        { value: 'gamma', label: 'Project Gamma' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Assignee">
                    <Select
                      placeholder="Assign to"
                      options={[
                        { value: 'alice', label: 'Alice Chen' },
                        { value: 'bob', label: 'Bob Kumar' },
                        { value: 'carol', label: 'Carol Wu' },
                        { value: 'dave', label: 'Dave Park' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Priority">
                    <Select
                      defaultValue="medium"
                      options={[
                        { value: 'critical', label: 'Critical' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Description">
                    <Input.TextArea rows={2} placeholder="Optional details..." />
                  </Form.Item>
                  <Button
                    type="primary"
                    block
                    style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', border: 'none' }}
                    icon={<PlusOutlined />}
                  >
                    Create Task
                  </Button>
                </Form>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={16}>
              <Card
                title={<Text strong>Project Updates</Text>}
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              >
                <Collapse items={collapseItems} defaultActiveKey={['1', '3']} />
              </Card>
            </Col>

            <Col span={8}>
              <Card
                title={<Text strong>Team Gallery</Text>}
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              >
                <Row gutter={[8, 8]}>
                  <Col span={12}>
                    <div
                      style={{
                        height: 100,
                        borderRadius: 8,
                        backgroundImage: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        display: 'flex',
                        alignItems: 'flex-end',
                        padding: 8,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>Alpha Sprint</Text>
                    </div>
                  </Col>
                  <Col span={12}>
                    <div
                      style={{
                        height: 100,
                        borderRadius: 8,
                        backgroundImage: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        display: 'flex',
                        alignItems: 'flex-end',
                        padding: 8,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>Beta Kickoff</Text>
                    </div>
                  </Col>
                  <Col span={12}>
                    <div
                      style={{
                        height: 100,
                        borderRadius: 8,
                        backgroundImage: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        display: 'flex',
                        alignItems: 'flex-end',
                        padding: 8,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>Infra Day</Text>
                    </div>
                  </Col>
                  <Col span={12}>
                    <div
                      style={{
                        height: 100,
                        borderRadius: 8,
                        backgroundImage: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        display: 'flex',
                        alignItems: 'flex-end',
                        padding: 8,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>Team Offsite</Text>
                    </div>
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>
        </Content>
      </Layout>

      <div
        style={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          zIndex: 100,
        }}
      >
        <Tooltip title="New Task" placement="left">
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={<PlusOutlined />}
            style={{
              width: 52,
              height: 52,
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              border: 'none',
              boxShadow: '0 4px 16px rgba(245, 87, 108, 0.5)',
              fontSize: 20,
            }}
          />
        </Tooltip>
      </div>
    </Layout>
  );
}
