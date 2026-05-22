import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Container,
  Grid,
  Card,
  CardContent,
  CardActions,
  Paper,
  Button,
  Chip,
  Avatar,
  Stack,
  Divider,
  LinearProgress,
  Alert,
  AlertTitle,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
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
  Notifications as NotificationsIcon,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Person,
} from '@mui/icons-material';

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

export default function App() {
  return (
    <Box sx={{ bgcolor: 'grey.100', minHeight: '100vh', pb: 6 }}>
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

      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Alert severity="success" sx={{ mb: 3 }}>
          <AlertTitle>On track</AlertTitle>
          Revenue grew 18% compared to the previous quarter.
        </Alert>

        <Grid container spacing={3}>
          {[
            { label: 'Active Users', value: '11,280', icon: <TrendingUp color="success" /> },
            { label: 'Revenue', value: '$93.4K', icon: <TrendingUp color="success" /> },
            { label: 'Churn', value: '2.8%', icon: <TrendingDown color="error" /> },
            { label: 'Satisfaction', value: '4.6/5', icon: <CheckCircle color="primary" /> },
          ].map((s) => (
            <Grid item xs={12} sm={6} md={3} key={s.label}>
              <Card>
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
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={3} sx={{ mt: 0 }}>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 2 }} elevation={3}>
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
          </Grid>

          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Tabs value={0} sx={{ mb: 2 }}>
                  <Tab label="Members" />
                  <Tab label="Invites" />
                </Tabs>
                <Stack spacing={2}>
                  {['Alice Chen', 'Bob Liu', 'Carol Wang'].map((n) => (
                    <Stack key={n} direction="row" spacing={2} alignItems="center">
                      <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
                        <Person fontSize="small" />
                      </Avatar>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="body2">{n}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Editor
                        </Typography>
                      </Box>
                      <CheckCircle color="success" fontSize="small" />
                    </Stack>
                  ))}
                </Stack>
                <Divider sx={{ my: 2 }} />
                <FormControlLabel control={<Switch defaultChecked />} label="Email alerts" />
              </CardContent>
              <CardActions>
                <Button size="small">Manage</Button>
                <Button size="small" variant="contained">
                  Invite
                </Button>
              </CardActions>
            </Card>
          </Grid>
        </Grid>

        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" gutterBottom>
            Tags
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label="design" color="secondary" />
            <Chip label="urgent" color="error" />
            <Chip label="review" color="warning" variant="outlined" />
            <Chip label="backend" color="primary" variant="outlined" />
            <Chip label="qa" color="info" />
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
