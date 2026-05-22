import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Card,
  CardContent,
  Paper,
  Button,
  Chip,
  Avatar,
  Stack,
  Divider,
  LinearProgress,
  Alert,
  AlertTitle,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
  Badge,
  TextField,
  Fab,
  Stepper,
  Step,
  StepLabel,
  StepContent,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  BarChart as BarChartIcon,
  Settings,
  Notifications as NotificationsIcon,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Add as AddIcon,
  Terminal,
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';

const SIDEBAR_WIDTH = 260;

const tableRows = [
  { name: 'Acme Corp', status: 'Active', mrr: '$12,400', health: 92, owner: 'Alice Chen' },
  { name: 'Globex Inc', status: 'At Risk', mrr: '$8,200', health: 38, owner: 'Bob Liu' },
  { name: 'Initech', status: 'Active', mrr: '$21,900', health: 87, owner: 'Carol Park' },
  { name: 'Umbrella Ltd', status: 'Churned', mrr: '$0', health: 0, owner: 'Dave Kim' },
  { name: 'Hooli', status: 'Active', mrr: '$5,600', health: 74, owner: 'Eve Torres' },
  { name: 'Pied Piper', status: 'Trial', mrr: '$0', health: 55, owner: 'Frank Ng' },
];

const statusColor: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  Active: 'success',
  'At Risk': 'warning',
  Churned: 'error',
  Trial: 'info',
};

const deploySteps = [
  { label: 'Lint & type-check', desc: 'ESLint + TypeScript compiler — 0 errors' },
  { label: 'Unit tests', desc: '312 passed, 0 failed (coverage 91%)' },
  { label: 'Build', desc: 'Vite production bundle — 1.2 MB gzipped' },
  { label: 'Deploy to staging', desc: 'Vercel preview deployment succeeded' },
  { label: 'Smoke tests', desc: 'Playwright E2E — 28/28 passed' },
];

const teamMembers = [
  { name: 'Alice Chen', role: 'Frontend', color: '#1976d2' },
  { name: 'Bob Liu', role: 'Backend', color: '#7b1fa2' },
  { name: 'Carol Park', role: 'Design', color: '#388e3c' },
  { name: 'Dave Kim', role: 'DevOps', color: '#f57c00' },
  { name: 'Eve Torres', role: 'QA', color: '#c62828' },
];

const TREE_EXPANDED = [
  'root',
  'frontend', 'fe-src', 'fe-components', 'fe-comp-ui', 'fe-comp-layout', 'fe-comp-charts', 'fe-comp-forms',
  'fe-pages', 'fe-hooks', 'fe-utils', 'fe-styles', 'fe-store', 'fe-types', 'fe-public',
  'backend', 'be-src', 'be-routes', 'be-models', 'be-services', 'be-middleware', 'be-jobs', 'be-config',
  'be-tests', 'be-t-unit', 'be-t-int',
  'infra', 'infra-k8s', 'infra-tf', 'infra-ci',
  'scripts', 'docs', 'shared', 'shared-types', 'shared-utils',
];

const placeholderImages = [
  { id: 1, w: 320, h: 200, label: 'Homepage hero' },
  { id: 2, w: 400, h: 225, label: 'Feature screenshot' },
  { id: 3, w: 280, h: 210, label: 'Mobile preview' },
  { id: 4, w: 360, h: 180, label: 'Analytics view' },
];

export default function App() {
  return (
    <Box sx={{ display: 'flex', bgcolor: '#f0f2f5', minHeight: '100vh' }}>
      <Box
        component="aside"
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          bgcolor: '#1e1e2e',
          height: '100vh',
          overflowY: 'auto',
          position: 'sticky',
          top: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ px: 2, py: 2, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Typography
            variant="h6"
            fontWeight={800}
            sx={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '-0.5px',
            }}
          >
            DevBoard
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>
            monorepo · main
          </Typography>
        </Box>

        <Box sx={{ px: 1, py: 1 }}>
          {[
            { label: 'Overview', icon: <DashboardIcon fontSize="small" /> },
            { label: 'Team', icon: <PeopleIcon fontSize="small" /> },
            { label: 'Deployments', icon: <Terminal fontSize="small" /> },
            { label: 'Usage', icon: <BarChartIcon fontSize="small" /> },
            { label: 'Settings', icon: <Settings fontSize="small" /> },
          ].map((item, i) => (
            <Box
              key={item.label}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 1,
                borderRadius: 1,
                cursor: 'pointer',
                bgcolor: i === 0 ? 'rgba(102,126,234,0.18)' : 'transparent',
                color: i === 0 ? '#667eea' : 'rgba(255,255,255,0.6)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.07)', color: '#fff' },
              }}
            >
              {item.icon}
              <Typography variant="body2" fontWeight={i === 0 ? 600 : 400}>
                {item.label}
              </Typography>
            </Box>
          ))}
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 1 }} />

        <Box sx={{ px: 1.5, pb: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.65rem' }}>
            Explorer
          </Typography>
        </Box>

        <Box sx={{ px: 0.5, pb: 2, flexGrow: 1 }}>
          <SimpleTreeView
            defaultExpandedItems={TREE_EXPANDED}
            sx={{
              color: 'rgba(255,255,255,0.75)',
              '& .MuiTreeItem-label': { fontSize: '0.78rem' },
              '& .MuiTreeItem-root': { my: 0 },
              '& .MuiTreeItem-content': { py: 0.25, borderRadius: 0.5 },
              '& .MuiTreeItem-content:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
              '& .MuiTreeItem-content.Mui-selected': { bgcolor: 'rgba(102,126,234,0.2)' },
            }}
          >
            <TreeItem itemId="root" label="devboard-monorepo">
              <TreeItem itemId="frontend" label="frontend/">
                <TreeItem itemId="fe-src" label="src/">
                  <TreeItem itemId="fe-components" label="components/">
                    <TreeItem itemId="fe-comp-ui" label="ui/">
                      <TreeItem itemId="fe-btn" label="Button.tsx" />
                      <TreeItem itemId="fe-input" label="Input.tsx" />
                      <TreeItem itemId="fe-modal" label="Modal.tsx" />
                      <TreeItem itemId="fe-tooltip" label="Tooltip.tsx" />
                      <TreeItem itemId="fe-badge" label="Badge.tsx" />
                      <TreeItem itemId="fe-spinner" label="Spinner.tsx" />
                      <TreeItem itemId="fe-dropdown" label="Dropdown.tsx" />
                    </TreeItem>
                    <TreeItem itemId="fe-comp-layout" label="layout/">
                      <TreeItem itemId="fe-header" label="Header.tsx" />
                      <TreeItem itemId="fe-sidebar" label="Sidebar.tsx" />
                      <TreeItem itemId="fe-footer" label="Footer.tsx" />
                      <TreeItem itemId="fe-grid" label="Grid.tsx" />
                      <TreeItem itemId="fe-container" label="Container.tsx" />
                    </TreeItem>
                    <TreeItem itemId="fe-comp-charts" label="charts/">
                      <TreeItem itemId="fe-linechart" label="LineChart.tsx" />
                      <TreeItem itemId="fe-barchart" label="BarChart.tsx" />
                      <TreeItem itemId="fe-piechart" label="PieChart.tsx" />
                      <TreeItem itemId="fe-areachart" label="AreaChart.tsx" />
                    </TreeItem>
                    <TreeItem itemId="fe-comp-forms" label="forms/">
                      <TreeItem itemId="fe-formfield" label="FormField.tsx" />
                      <TreeItem itemId="fe-select" label="Select.tsx" />
                      <TreeItem itemId="fe-datepicker" label="DatePicker.tsx" />
                      <TreeItem itemId="fe-fileupload" label="FileUpload.tsx" />
                    </TreeItem>
                  </TreeItem>
                  <TreeItem itemId="fe-pages" label="pages/">
                    <TreeItem itemId="fe-page-home" label="Home.tsx" />
                    <TreeItem itemId="fe-page-dash" label="Dashboard.tsx" />
                    <TreeItem itemId="fe-page-users" label="Users.tsx" />
                    <TreeItem itemId="fe-page-settings" label="Settings.tsx" />
                    <TreeItem itemId="fe-page-billing" label="Billing.tsx" />
                    <TreeItem itemId="fe-page-reports" label="Reports.tsx" />
                    <TreeItem itemId="fe-page-onboard" label="Onboarding.tsx" />
                  </TreeItem>
                  <TreeItem itemId="fe-hooks" label="hooks/">
                    <TreeItem itemId="fe-hook-auth" label="useAuth.ts" />
                    <TreeItem itemId="fe-hook-data" label="useData.ts" />
                    <TreeItem itemId="fe-hook-theme" label="useTheme.ts" />
                    <TreeItem itemId="fe-hook-notify" label="useNotify.ts" />
                    <TreeItem itemId="fe-hook-ws" label="useWebSocket.ts" />
                    <TreeItem itemId="fe-hook-form" label="useForm.ts" />
                  </TreeItem>
                  <TreeItem itemId="fe-store" label="store/">
                    <TreeItem itemId="fe-store-auth" label="authSlice.ts" />
                    <TreeItem itemId="fe-store-ui" label="uiSlice.ts" />
                    <TreeItem itemId="fe-store-data" label="dataSlice.ts" />
                    <TreeItem itemId="fe-store-root" label="index.ts" />
                  </TreeItem>
                  <TreeItem itemId="fe-utils" label="utils/">
                    <TreeItem itemId="fe-util-format" label="format.ts" />
                    <TreeItem itemId="fe-util-api" label="api.ts" />
                    <TreeItem itemId="fe-util-auth" label="auth.ts" />
                    <TreeItem itemId="fe-util-date" label="date.ts" />
                    <TreeItem itemId="fe-util-validate" label="validate.ts" />
                  </TreeItem>
                  <TreeItem itemId="fe-types" label="types/">
                    <TreeItem itemId="fe-type-api" label="api.d.ts" />
                    <TreeItem itemId="fe-type-models" label="models.d.ts" />
                    <TreeItem itemId="fe-type-events" label="events.d.ts" />
                  </TreeItem>
                  <TreeItem itemId="fe-styles" label="styles/">
                    <TreeItem itemId="fe-style-global" label="global.css" />
                    <TreeItem itemId="fe-style-tokens" label="tokens.css" />
                    <TreeItem itemId="fe-style-theme" label="theme.ts" />
                    <TreeItem itemId="fe-style-anims" label="animations.css" />
                  </TreeItem>
                  <TreeItem itemId="fe-app" label="App.tsx" />
                  <TreeItem itemId="fe-main" label="main.tsx" />
                  <TreeItem itemId="fe-vite" label="vite-env.d.ts" />
                </TreeItem>
                <TreeItem itemId="fe-public" label="public/">
                  <TreeItem itemId="fe-pub-icons" label="icons/">
                    <TreeItem itemId="fe-pub-icon-favicon" label="favicon.svg" />
                    <TreeItem itemId="fe-pub-icon-logo" label="logo.svg" />
                  </TreeItem>
                  <TreeItem itemId="fe-pub-fonts" label="fonts/" />
                  <TreeItem itemId="fe-pub-index" label="index.html" />
                </TreeItem>
                <TreeItem itemId="fe-pkg" label="package.json" />
                <TreeItem itemId="fe-tsconfig" label="tsconfig.json" />
                <TreeItem itemId="fe-viteconfig" label="vite.config.ts" />
                <TreeItem itemId="fe-tailwind" label="tailwind.config.ts" />
              </TreeItem>

              <TreeItem itemId="backend" label="backend/">
                <TreeItem itemId="be-src" label="src/">
                  <TreeItem itemId="be-routes" label="routes/">
                    <TreeItem itemId="be-rt-auth" label="auth.ts" />
                    <TreeItem itemId="be-rt-users" label="users.ts" />
                    <TreeItem itemId="be-rt-projects" label="projects.ts" />
                    <TreeItem itemId="be-rt-billing" label="billing.ts" />
                    <TreeItem itemId="be-rt-webhooks" label="webhooks.ts" />
                    <TreeItem itemId="be-rt-admin" label="admin.ts" />
                  </TreeItem>
                  <TreeItem itemId="be-models" label="models/">
                    <TreeItem itemId="be-mod-user" label="User.ts" />
                    <TreeItem itemId="be-mod-project" label="Project.ts" />
                    <TreeItem itemId="be-mod-org" label="Organization.ts" />
                    <TreeItem itemId="be-mod-invoice" label="Invoice.ts" />
                    <TreeItem itemId="be-mod-event" label="Event.ts" />
                    <TreeItem itemId="be-mod-audit" label="AuditLog.ts" />
                  </TreeItem>
                  <TreeItem itemId="be-services" label="services/">
                    <TreeItem itemId="be-svc-email" label="email.ts" />
                    <TreeItem itemId="be-svc-stripe" label="stripe.ts" />
                    <TreeItem itemId="be-svc-s3" label="s3.ts" />
                    <TreeItem itemId="be-svc-queue" label="queue.ts" />
                    <TreeItem itemId="be-svc-search" label="search.ts" />
                    <TreeItem itemId="be-svc-notify" label="notifications.ts" />
                  </TreeItem>
                  <TreeItem itemId="be-middleware" label="middleware/">
                    <TreeItem itemId="be-mid-auth" label="authenticate.ts" />
                    <TreeItem itemId="be-mid-rate" label="rateLimit.ts" />
                    <TreeItem itemId="be-mid-log" label="logger.ts" />
                    <TreeItem itemId="be-mid-cors" label="cors.ts" />
                    <TreeItem itemId="be-mid-validate" label="validate.ts" />
                  </TreeItem>
                  <TreeItem itemId="be-jobs" label="jobs/">
                    <TreeItem itemId="be-job-reports" label="generateReports.ts" />
                    <TreeItem itemId="be-job-billing" label="processBilling.ts" />
                    <TreeItem itemId="be-job-cleanup" label="cleanup.ts" />
                  </TreeItem>
                  <TreeItem itemId="be-config" label="config/">
                    <TreeItem itemId="be-conf-env" label="env.ts" />
                    <TreeItem itemId="be-conf-db" label="database.ts" />
                    <TreeItem itemId="be-conf-redis" label="redis.ts" />
                  </TreeItem>
                  <TreeItem itemId="be-app" label="app.ts" />
                  <TreeItem itemId="be-server" label="server.ts" />
                  <TreeItem itemId="be-db" label="db.ts" />
                </TreeItem>
                <TreeItem itemId="be-tests" label="tests/">
                  <TreeItem itemId="be-t-unit" label="unit/">
                    <TreeItem itemId="be-t-u-auth" label="auth.test.ts" />
                    <TreeItem itemId="be-t-u-billing" label="billing.test.ts" />
                    <TreeItem itemId="be-t-u-users" label="users.test.ts" />
                  </TreeItem>
                  <TreeItem itemId="be-t-int" label="integration/">
                    <TreeItem itemId="be-t-i-api" label="api.test.ts" />
                    <TreeItem itemId="be-t-i-db" label="database.test.ts" />
                  </TreeItem>
                </TreeItem>
                <TreeItem itemId="be-pkg" label="package.json" />
                <TreeItem itemId="be-tsconfig" label="tsconfig.json" />
                <TreeItem itemId="be-dockerfile" label="Dockerfile" />
                <TreeItem itemId="be-dockercompose" label="docker-compose.yml" />
              </TreeItem>

              <TreeItem itemId="shared" label="shared/">
                <TreeItem itemId="shared-types" label="types/">
                  <TreeItem itemId="shared-t-common" label="common.d.ts" />
                  <TreeItem itemId="shared-t-api" label="api.d.ts" />
                  <TreeItem itemId="shared-t-events" label="events.d.ts" />
                </TreeItem>
                <TreeItem itemId="shared-utils" label="utils/">
                  <TreeItem itemId="shared-u-format" label="format.ts" />
                  <TreeItem itemId="shared-u-validate" label="validate.ts" />
                  <TreeItem itemId="shared-u-crypto" label="crypto.ts" />
                </TreeItem>
                <TreeItem itemId="shared-pkg" label="package.json" />
              </TreeItem>

              <TreeItem itemId="infra" label="infra/">
                <TreeItem itemId="infra-k8s" label="k8s/">
                  <TreeItem itemId="infra-k8s-deploy" label="deployment.yaml" />
                  <TreeItem itemId="infra-k8s-svc" label="service.yaml" />
                  <TreeItem itemId="infra-k8s-ingress" label="ingress.yaml" />
                  <TreeItem itemId="infra-k8s-hpa" label="hpa.yaml" />
                  <TreeItem itemId="infra-k8s-cm" label="configmap.yaml" />
                  <TreeItem itemId="infra-k8s-secret" label="secret.yaml" />
                </TreeItem>
                <TreeItem itemId="infra-tf" label="terraform/">
                  <TreeItem itemId="infra-tf-main" label="main.tf" />
                  <TreeItem itemId="infra-tf-vars" label="variables.tf" />
                  <TreeItem itemId="infra-tf-out" label="outputs.tf" />
                  <TreeItem itemId="infra-tf-vpc" label="vpc.tf" />
                  <TreeItem itemId="infra-tf-rds" label="rds.tf" />
                </TreeItem>
                <TreeItem itemId="infra-ci" label=".github/">
                  <TreeItem itemId="infra-ci-deploy" label="deploy.yml" />
                  <TreeItem itemId="infra-ci-test" label="ci.yml" />
                  <TreeItem itemId="infra-ci-release" label="release.yml" />
                </TreeItem>
              </TreeItem>

              <TreeItem itemId="scripts" label="scripts/">
                <TreeItem itemId="sc-seed" label="seed.ts" />
                <TreeItem itemId="sc-migrate" label="migrate.ts" />
                <TreeItem itemId="sc-codegen" label="codegen.ts" />
                <TreeItem itemId="sc-perf" label="perf-test.ts" />
              </TreeItem>

              <TreeItem itemId="docs" label="docs/">
                <TreeItem itemId="doc-arch" label="architecture.md" />
                <TreeItem itemId="doc-api" label="api.md" />
                <TreeItem itemId="doc-deploy" label="deployment.md" />
                <TreeItem itemId="doc-contrib" label="contributing.md" />
                <TreeItem itemId="doc-adr" label="adr/" />
              </TreeItem>

              <TreeItem itemId="root-pkg" label="package.json" />
              <TreeItem itemId="root-readme" label="README.md" />
              <TreeItem itemId="root-gitignore" label=".gitignore" />
              <TreeItem itemId="root-eslint" label=".eslintrc.js" />
              <TreeItem itemId="root-prettier" label=".prettierrc" />
              <TreeItem itemId="root-turbo" label="turbo.json" />
              <TreeItem itemId="root-pnpm" label="pnpm-workspace.yaml" />
            </TreeItem>
          </SimpleTreeView>
        </Box>
      </Box>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="sticky"
          elevation={0}
          sx={{ bgcolor: '#fff', borderBottom: '1px solid #e5e7eb', color: 'text.primary' }}
        >
          <Toolbar sx={{ gap: 2 }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography
                variant="h5"
                fontWeight={800}
                sx={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  display: 'inline-block',
                }}
              >
                DevBoard
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                Overview · Q2 2025
              </Typography>
            </Box>
            <Badge badgeContent={3} color="error">
              <IconButton>
                <NotificationsIcon />
              </IconButton>
            </Badge>
            <Button variant="contained" size="small" startIcon={<AddIcon />}
              sx={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', boxShadow: 'none' }}>
              New Deploy
            </Button>
            <Avatar sx={{ bgcolor: '#667eea', width: 34, height: 34, fontSize: '0.8rem' }}>AC</Avatar>
          </Toolbar>
        </AppBar>

        <Box sx={{ p: 3, flexGrow: 1 }}>
          <Alert severity="success" sx={{ mb: 3 }} onClose={() => {}}>
            <AlertTitle>Deployment succeeded</AlertTitle>
            v2.14.0 was deployed to production 12 minutes ago — all health checks passed.
          </Alert>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ mb: 3 }}>
            {[
              { label: 'Active Users', value: '24,819', delta: '+12%', up: true, color: '#667eea' },
              { label: 'MRR', value: '$48,200', delta: '+8.4%', up: true, color: '#764ba2' },
              { label: 'Churn Rate', value: '1.9%', delta: '-0.3%', up: false, color: '#06b6d4' },
              { label: 'API p99', value: '142 ms', delta: '-18ms', up: false, color: '#10b981' },
            ].map((s) => (
              <Card key={s.label} sx={{ flex: 1, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <CardContent>
                  <Typography color="text.secondary" variant="caption" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">
                    {s.label}
                  </Typography>
                  <Typography variant="h4" fontWeight={700} sx={{ my: 0.5, color: s.color }}>
                    {s.value}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    {s.up ? <TrendingUp sx={{ fontSize: 14, color: '#10b981' }} /> : <TrendingDown sx={{ fontSize: 14, color: '#10b981' }} />}
                    <Typography variant="caption" sx={{ color: '#10b981', fontWeight: 600 }}>{s.delta} this week</Typography>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>

          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ mb: 3 }}>
            <Paper sx={{ p: 2.5, flex: 2, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
              <Typography variant="h6" fontWeight={700} gutterBottom>Revenue Trend</Typography>
              <LineChart
                height={240}
                series={[
                  { data: [28, 35, 31, 44, 52, 48, 61, 58, 67, 72, 69, 81], label: '2025', color: '#667eea' },
                  { data: [18, 22, 20, 28, 33, 30, 38, 36, 41, 44, 42, 51], label: '2024', color: '#e2e8f0' },
                ]}
                xAxis={[{ scaleType: 'point', data: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] }]}
              />
            </Paper>
            <Paper sx={{ p: 2.5, flex: 1, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
              <Typography variant="h6" fontWeight={700} gutterBottom>Traffic Sources</Typography>
              <PieChart
                height={240}
                series={[{
                  data: [
                    { id: 0, value: 42, label: 'Direct', color: '#667eea' },
                    { id: 1, value: 28, label: 'Organic', color: '#764ba2' },
                    { id: 2, value: 18, label: 'Paid', color: '#06b6d4' },
                    { id: 3, value: 12, label: 'Referral', color: '#10b981' },
                  ],
                  innerRadius: 50,
                }]}
              />
            </Paper>
          </Stack>

          <Paper sx={{ p: 2.5, mb: 3, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
            <Typography variant="h6" fontWeight={700} gutterBottom>Sprint Velocity</Typography>
            <BarChart
              height={200}
              series={[
                { data: [38, 44, 41, 52, 49, 58, 62, 55, 67], label: 'Completed', color: '#667eea' },
                { data: [42, 42, 48, 52, 54, 58, 64, 60, 68], label: 'Planned', color: '#e2e8f0' },
              ]}
              xAxis={[{ scaleType: 'band', data: ['S1','S2','S3','S4','S5','S6','S7','S8','S9'] }]}
            />
          </Paper>

          <Paper sx={{ p: 2.5, mb: 3, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6" fontWeight={700}>Accounts</Typography>
              <Stack direction="row" spacing={1}>
                <Chip label="All" size="small" color="primary" />
                <Chip label="Active" size="small" variant="outlined" />
                <Chip label="At Risk" size="small" variant="outlined" />
              </Stack>
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, color: 'text.secondary', fontSize: '0.75rem', textTransform: 'uppercase' } }}>
                  <TableCell>Company</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">MRR</TableCell>
                  <TableCell>Health</TableCell>
                  <TableCell>Owner</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tableRows.map((r) => (
                  <TableRow key={r.name} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar sx={{ width: 28, height: 28, fontSize: '0.7rem', bgcolor: '#667eea' }}>
                          {r.name[0]}
                        </Avatar>
                        <Typography variant="body2" fontWeight={600}>{r.name}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip label={r.status} color={statusColor[r.status] ?? 'default'} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>{r.mrr}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 140 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <LinearProgress
                          variant="determinate"
                          value={r.health}
                          sx={{
                            flexGrow: 1, height: 6, borderRadius: 3,
                            '& .MuiLinearProgress-bar': {
                              bgcolor: r.health >= 70 ? '#10b981' : r.health >= 40 ? '#f59e0b' : '#ef4444',
                            },
                          }}
                        />
                        <Typography variant="caption" color="text.secondary">{r.health}%</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Avatar sx={{ width: 22, height: 22, fontSize: '0.6rem', bgcolor: '#764ba2' }}>
                          {r.owner.split(' ').map(n => n[0]).join('')}
                        </Avatar>
                        <Typography variant="body2">{r.owner}</Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mb: 3 }}>
            <Paper sx={{ p: 2.5, flex: 1, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
              <Typography variant="h6" fontWeight={700} gutterBottom>Latest Deploy Pipeline</Typography>
              <Stepper orientation="vertical" activeStep={4}>
                {deploySteps.map((step) => (
                  <Step key={step.label} completed>
                    <StepLabel
                      StepIconProps={{ sx: { color: '#10b981' } } as any}
                    >
                      <Typography variant="body2" fontWeight={600}>{step.label}</Typography>
                    </StepLabel>
                    <StepContent>
                      <Typography variant="caption" color="text.secondary">{step.desc}</Typography>
                    </StepContent>
                  </Step>
                ))}
              </Stepper>
            </Paper>

            <Paper sx={{ p: 2.5, flex: 1, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
              <Typography variant="h6" fontWeight={700} gutterBottom>Team</Typography>
              <Stack spacing={1.5}>
                {teamMembers.map((m) => (
                  <Stack key={m.name} direction="row" spacing={1.5} alignItems="center">
                    <Avatar sx={{ bgcolor: m.color, width: 36, height: 36, fontSize: '0.8rem' }}>
                      {m.name.split(' ').map(n => n[0]).join('')}
                    </Avatar>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{m.role}</Typography>
                    </Box>
                    <Badge color="success" variant="dot">
                      <CheckCircle sx={{ fontSize: 16, color: '#10b981' }} />
                    </Badge>
                  </Stack>
                ))}
              </Stack>
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'k8s'].map((tag) => (
                  <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                ))}
              </Stack>
            </Paper>
          </Stack>

          <Paper sx={{ p: 2.5, mb: 3, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
            <Typography variant="h6" fontWeight={700} gutterBottom>Screenshot Gallery</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Recent UI captures from automated visual regression tests.
            </Typography>
            <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 1 }}>
              {placeholderImages.map((img) => (
                <Box key={img.id} sx={{ flexShrink: 0, position: 'relative' }}>
                  <Box
                    component="img"
                    src={`https://picsum.photos/${img.w}/${img.h}?random=${img.id + 10}`}
                    alt={img.label}
                    sx={{
                      width: img.w * 0.55,
                      height: img.h * 0.55,
                      objectFit: 'cover',
                      borderRadius: 1.5,
                      display: 'block',
                      border: '1px solid #e5e7eb',
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {img.label}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>

          <Paper sx={{ p: 2.5, mb: 3, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} elevation={0}>
            <Typography variant="h6" fontWeight={700} gutterBottom>Project Settings</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <TextField
                label="Project Name"
                defaultValue="devboard-monorepo"
                size="small"
                sx={{ flex: 1 }}
                InputProps={{ sx: { outline: '1.5px solid transparent', '&:focus-within': { outline: '1.5px solid #667eea' } } }}
              />
              <TextField
                label="Environment"
                defaultValue="production"
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label="Region"
                defaultValue="us-east-1"
                size="small"
                sx={{ flex: 1 }}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="API Base URL"
                defaultValue="https://api.devboard.io/v2"
                size="small"
                sx={{ flex: 2 }}
              />
              <TextField
                label="Rate Limit (req/min)"
                defaultValue="1000"
                type="number"
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label="Timeout (ms)"
                defaultValue="5000"
                type="number"
                size="small"
                sx={{ flex: 1 }}
              />
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
              <Button
                variant="contained"
                size="small"
                sx={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', boxShadow: 'none' }}
              >
                Save Changes
              </Button>
              <Button variant="outlined" size="small" color="inherit">
                Reset
              </Button>
            </Stack>
          </Paper>

          <Alert severity="info" sx={{ mb: 2 }}>
            <AlertTitle>Scheduled maintenance</AlertTitle>
            The API gateway will undergo a rolling restart on Saturday 03:00–03:30 UTC. Expect &lt;30s of elevated latency.
          </Alert>
        </Box>
      </Box>

      <Fab
        color="primary"
        aria-label="new deployment"
        sx={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          boxShadow: '0 4px 20px rgba(102,126,234,0.45)',
        }}
      >
        <AddIcon />
      </Fab>
    </Box>
  );
}
