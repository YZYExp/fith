import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
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
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  ShoppingCart,
  BarChart as BarChartIcon,
  Settings,
  Notifications as NotificationsIcon,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Person,
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';

const DRAWER = 240;

const rows = [
  { name: 'Acme Corp', status: 'Active', amount: '$4,200', progress: 80 },
  { name: 'Globex', status: 'Pending', amount: '$1,800', progress: 45 },
  { name: 'Initech', status: 'Closed', amount: '$9,100', progress: 100 },
];
const statColor: Record<string, 'success' | 'warning' | 'default'> = {
  Active: 'success',
  Pending: 'warning',
  Closed: 'default',
};

const nav = [
  { label: 'Dashboard', icon: <DashboardIcon /> },
  { label: 'Customers', icon: <PeopleIcon /> },
  { label: 'Orders', icon: <ShoppingCart /> },
  { label: 'Reports', icon: <BarChartIcon /> },
  { label: 'Settings', icon: <Settings /> },
];

export default function App() {
  return (
    <Box sx={{ display: 'flex', bgcolor: 'grey.100', minHeight: '100vh' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER, boxSizing: 'border-box' },
        }}
      >
        <Toolbar>
          <Typography variant="h6" noWrap fontWeight={700}>
            fitting-html
          </Typography>
        </Toolbar>
        <Divider />
        <List>
          {nav.map((n, i) => (
            <ListItemButton key={n.label} selected={i === 0}>
              <ListItemIcon>{n.icon}</ListItemIcon>
              <ListItemText primary={n.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      <Box sx={{ flexGrow: 1 }}>
        <AppBar position="static">
          <Toolbar>
            <IconButton edge="start" color="inherit" sx={{ mr: 2 }}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              Sales Dashboard
            </Typography>
            <Badge badgeContent={5} color="error" sx={{ mr: 2 }}>
              <NotificationsIcon />
            </Badge>
            <Button color="inherit" variant="outlined">
              New Report
            </Button>
          </Toolbar>
        </AppBar>

        <Box sx={{ p: 3 }}>
          <Alert severity="success" sx={{ mb: 3 }}>
            <AlertTitle>On track</AlertTitle>
            Revenue grew 18% compared to the previous quarter.
          </Alert>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mb: 3 }}>
            {[
              { label: 'Active Users', value: '11,280', icon: <TrendingUp color="success" /> },
              { label: 'Revenue', value: '$93.4K', icon: <TrendingUp color="success" /> },
              { label: 'Churn', value: '2.8%', icon: <TrendingDown color="error" /> },
              { label: 'Satisfaction', value: '4.6/5', icon: <CheckCircle color="primary" /> },
            ].map((s) => (
              <Card key={s.label} sx={{ flex: 1 }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography color="text.secondary" variant="body2">
                        {s.label}
                      </Typography>
                      <Typography variant="h5">{s.value}</Typography>
                    </Box>
                    {s.icon}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mb: 3 }}>
            <Paper sx={{ p: 2, flex: 2 }} elevation={3}>
              <Typography variant="h6" gutterBottom>
                Revenue trend
              </Typography>
              <LineChart
                height={240}
                series={[
                  { data: [12, 19, 14, 23, 28, 26, 32], label: 'This year', color: '#1976d2' },
                  { data: [8, 11, 13, 15, 18, 17, 21], label: 'Last year', color: '#9c27b0' },
                ]}
                xAxis={[{ scaleType: 'point', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }]}
              />
            </Paper>
            <Paper sx={{ p: 2, flex: 1 }} elevation={3}>
              <Typography variant="h6" gutterBottom>
                By channel
              </Typography>
              <PieChart
                height={240}
                series={[
                  {
                    data: [
                      { id: 0, value: 40, label: 'Direct', color: '#1976d2' },
                      { id: 1, value: 30, label: 'Organic', color: '#2e7d32' },
                      { id: 2, value: 30, label: 'Referral', color: '#ed6c02' },
                    ],
                  },
                ]}
              />
            </Paper>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
            <Paper sx={{ p: 2, flex: 2 }} elevation={3}>
              <Typography variant="h6" gutterBottom>
                Accounts
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Progress</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>
                        <Chip label={r.status} color={statColor[r.status]} size="small" />
                      </TableCell>
                      <TableCell align="right">{r.amount}</TableCell>
                      <TableCell sx={{ minWidth: 120 }}>
                        <LinearProgress variant="determinate" value={r.progress} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            <Paper sx={{ p: 2, flex: 1 }} elevation={3}>
              <Typography variant="h6" gutterBottom>
                Weekly orders
              </Typography>
              <BarChart
                height={200}
                series={[{ data: [42, 55, 38, 61, 47], color: '#2e7d32' }]}
                xAxis={[{ scaleType: 'band', data: ['W1', 'W2', 'W3', 'W4', 'W5'] }]}
              />
              <Divider sx={{ my: 2 }} />
              <Stack spacing={1.5}>
                {['Alice Chen', 'Bob Liu'].map((n) => (
                  <Stack key={n} direction="row" spacing={2} alignItems="center">
                    <Avatar sx={{ bgcolor: 'primary.main', width: 28, height: 28 }}>
                      <Person fontSize="small" />
                    </Avatar>
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>
                      {n}
                    </Typography>
                    <CheckCircle color="success" fontSize="small" />
                  </Stack>
                ))}
              </Stack>
            </Paper>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
