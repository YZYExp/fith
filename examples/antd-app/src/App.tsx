import {
  Layout,
  Menu,
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Progress,
  Alert,
  Button,
  Space,
  Avatar,
  List,
  Typography,
  Descriptions,
  Badge,
  Steps,
  Timeline,
  Divider,
  Tabs,
  Rate,
} from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  SettingOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  UserOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;
const { Title, Paragraph, Text } = Typography;

interface RowData {
  key: string;
  name: string;
  status: string;
  amount: number;
  progress: number;
}

const data: RowData[] = [
  { key: '1', name: 'Acme Corp', status: 'active', amount: 4200, progress: 80 },
  { key: '2', name: 'Globex', status: 'pending', amount: 1800, progress: 45 },
  { key: '3', name: 'Initech', status: 'closed', amount: 9100, progress: 100 },
  { key: '4', name: 'Umbrella', status: 'active', amount: 3300, progress: 62 },
];

const statusColor: Record<string, string> = { active: 'green', pending: 'gold', closed: 'default' };

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark">
        <div
          style={{
            height: 56,
            margin: 16,
            color: '#fff',
            fontWeight: 700,
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <DashboardOutlined /> fitting-html
        </div>
        <Menu
          theme="dark"
          mode="inline"
          defaultSelectedKeys={['1']}
          items={[
            { key: '1', icon: <DashboardOutlined />, label: 'Dashboard' },
            { key: '2', icon: <TeamOutlined />, label: 'Customers' },
            { key: '3', icon: <SettingOutlined />, label: 'Settings' },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title level={4} style={{ margin: 0 }}>
            Sales Dashboard
          </Title>
          <Space>
            <Badge count={5}>
              <Avatar shape="square" icon={<UserOutlined />} />
            </Badge>
            <Button type="primary">New Report</Button>
          </Space>
        </Header>
        <Content style={{ margin: 24 }}>
          <Alert
            message="Quarterly targets are on track"
            description="Revenue grew 18% compared to the previous quarter."
            type="success"
            showIcon
            style={{ marginBottom: 24 }}
          />

          <Row gutter={24}>
            <Col span={6}>
              <Card>
                <Statistic title="Active Users" value={11280} prefix={<ArrowUpOutlined />} valueStyle={{ color: '#3f8600' }} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="Revenue" value={93.4} suffix="K" precision={1} valueStyle={{ color: '#3f8600' }} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="Churn" value={2.8} suffix="%" prefix={<ArrowDownOutlined />} valueStyle={{ color: '#cf1322' }} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="Satisfaction" value={4.6} suffix="/5" />
                <Rate disabled defaultValue={5} style={{ fontSize: 14 }} />
              </Card>
            </Col>
          </Row>

          <Row gutter={24} style={{ marginTop: 24 }}>
            <Col span={16}>
              <Card title="Accounts" extra={<Button size="small">Export</Button>}>
                <Table<RowData>
                  dataSource={data}
                  pagination={false}
                  columns={[
                    { title: 'Name', dataIndex: 'name', key: 'name' },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      key: 'status',
                      render: (s: string) => <Tag color={statusColor[s]}>{s.toUpperCase()}</Tag>,
                    },
                    { title: 'Amount', dataIndex: 'amount', key: 'amount', render: (a: number) => `$${a.toLocaleString()}` },
                    {
                      title: 'Progress',
                      dataIndex: 'progress',
                      key: 'progress',
                      render: (p: number) => <Progress percent={p} size="small" />,
                    },
                  ]}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card title="Activity">
                <Timeline
                  items={[
                    { color: 'green', children: 'Deal closed with Initech' },
                    { color: 'blue', children: 'New lead: Umbrella Inc' },
                    { color: 'red', children: 'Payment overdue: Globex' },
                    { children: 'Quarterly review scheduled' },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={24} style={{ marginTop: 24 }}>
            <Col span={12}>
              <Card title="Onboarding">
                <Steps
                  current={1}
                  items={[{ title: 'Signed up' }, { title: 'In progress' }, { title: 'Live' }]}
                />
                <Divider />
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Plan">Enterprise</Descriptions.Item>
                  <Descriptions.Item label="Seats">120</Descriptions.Item>
                  <Descriptions.Item label="Renewal">2026-09-01</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col span={12}>
              <Card title="Team">
                <Tabs
                  defaultActiveKey="1"
                  items={[
                    {
                      key: '1',
                      label: 'Members',
                      children: (
                        <List
                          itemLayout="horizontal"
                          dataSource={[
                            { name: 'Alice Chen', role: 'Admin' },
                            { name: 'Bob Liu', role: 'Editor' },
                            { name: 'Carol Wang', role: 'Viewer' },
                          ]}
                          renderItem={(item) => (
                            <List.Item>
                              <List.Item.Meta
                                avatar={<Avatar icon={<UserOutlined />} />}
                                title={<Text strong>{item.name}</Text>}
                                description={item.role}
                              />
                              <CheckCircleOutlined style={{ color: '#52c41a' }} />
                            </List.Item>
                          )}
                        />
                      ),
                    },
                    { key: '2', label: 'Invites', children: <Paragraph>No pending invites.</Paragraph> },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          <Card style={{ marginTop: 24 }}>
            <Title level={5}>Notes</Title>
            <Paragraph>
              This dashboard exercises a wide range of Ant Design components — layout, cards, tables,
              tags, progress bars, statistics, timelines, steps, descriptions, tabs and lists — to
              validate the fidelity of the HTML&rarr;SVG conversion.
            </Paragraph>
            <Space wrap>
              <Tag color="magenta">design</Tag>
              <Tag color="red">urgent</Tag>
              <Tag color="volcano">review</Tag>
              <Tag color="blue">backend</Tag>
              <Tag color="cyan">qa</Tag>
            </Space>
          </Card>
        </Content>
      </Layout>
    </Layout>
  );
}
