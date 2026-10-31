import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import {
  Cloud,
  LogOut,
  PlusCircle,
  RefreshCw,
  Clock,
  CheckCircle,
  AlertCircle,
  PlayCircle,
  Sliders,
  Search,
  Filter,
  Eye,
  X
} from 'lucide-react';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  
  // Create Job Form
  const [jobType, setJobType] = useState('email-notification');
  const [priority, setPriority] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState('');

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Job Details Modal
  const [selectedJob, setSelectedJob] = useState(null);

  const fetchJobs = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.getJobs();
      setJobs(data || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(() => fetchJobs(), 3000); // 3s polling for real-time lifecycle tracking
    return () => clearInterval(interval);
  }, []);

  const handleCreateJob = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormSuccess('');
    setError('');

    try {
      await api.createJob(jobType, priority);
      setFormSuccess(`Job "${jobType}" created with priority ${priority}!`);
      setTimeout(() => setFormSuccess(''), 4000);
      fetchJobs();
    } catch (err) {
      setError(err.message || 'Failed to create job');
    } finally {
      setSubmitting(false);
    }
  };

  // Stats calculation
  const stats = {
    total: jobs.length,
    queued: jobs.filter(j => j.status === 'QUEUED').length,
    processing: jobs.filter(j => j.status === 'PROCESSING').length,
    completed: jobs.filter(j => j.status === 'COMPLETED').length,
    failed: jobs.filter(j => j.status === 'FAILED').length,
  };

  const filteredJobs = jobs.filter(job => {
    const matchesSearch = job.type.toLowerCase().includes(search.toLowerCase()) || String(job.id).includes(search);
    const matchesStatus = statusFilter === 'ALL' || job.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'QUEUED':
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontWeight: 600 }}><Clock size={12}/> QUEUED</span>;
      case 'PROCESSING':
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', fontWeight: 600 }}><PlayCircle size={12}/> PROCESSING</span>;
      case 'COMPLETED':
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: 600 }}><CheckCircle size={12}/> COMPLETED</span>;
      case 'FAILED':
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', fontWeight: 600 }}><AlertCircle size={12}/> FAILED</span>;
      default:
        return status;
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Navbar */}
      <header style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        padding: '16px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--accent)', padding: '8px', borderRadius: '6px', color: '#0f172a' }}>
            <Cloud size={22} />
          </div>
          <div>
            <span style={{ fontWeight: 'bold', fontSize: '16px' }}>Cloud Job Platform</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '10px' }}>Transactional Outbox & Worker</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ fontSize: '13px', textAlign: 'right' }}>
            <div style={{ fontWeight: 600 }}>{user?.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{user?.email}</div>
          </div>
          <button
            onClick={logout}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px'
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '32px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        {/* Statistics Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '28px' }}>
          <div style={{ background: 'var(--bg-surface)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TOTAL JOBS</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '4px' }}>{stats.total}</div>
          </div>
          <div style={{ background: 'var(--bg-surface)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: '#818cf8' }}>QUEUED</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '4px', color: '#818cf8' }}>{stats.queued}</div>
          </div>
          <div style={{ background: 'var(--bg-surface)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: '#fbbf24' }}>PROCESSING</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '4px', color: '#fbbf24' }}>{stats.processing}</div>
          </div>
          <div style={{ background: 'var(--bg-surface)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: '#34d399' }}>COMPLETED</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '4px', color: '#34d399' }}>{stats.completed}</div>
          </div>
          <div style={{ background: 'var(--bg-surface)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: '#f87171' }}>FAILED</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '4px', color: '#f87171' }}>{stats.failed}</div>
          </div>
        </div>

        {/* Create Job Card */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '24px', marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <PlusCircle size={20} color="var(--accent)" />
            <h2 style={{ fontSize: '16px' }}>Dispatch New Job</h2>
          </div>

          {formSuccess && (
            <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--success)', color: '#6ee7b7', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
              {formSuccess}
            </div>
          )}

          <form onSubmit={handleCreateJob} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr auto', gap: '16px', alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px' }}>Job Type</label>
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="email-notification">email-notification (Standard notification)</option>
                <option value="report-generator">report-generator (Heavy aggregation)</option>
                <option value="image-thumbnail">image-thumbnail (Media transform)</option>
                <option value="test-failure">test-failure (Simulates crash & 3x retries)</option>
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Priority (1 to 10)</label>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)' }}>Score: {priority}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                background: 'var(--accent)',
                color: '#0f172a',
                padding: '10px 24px',
                height: '42px',
                fontWeight: 600,
                fontSize: '14px'
              }}
            >
              {submitting ? 'Submitting...' : 'Queue Job'}
            </button>
          </form>
        </div>

        {/* Jobs Table Section */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          {/* Table Header Controls */}
          <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h3 style={{ fontSize: '16px' }}>My Cloud Jobs</h3>
              <button
                onClick={() => fetchJobs(true)}
                style={{
                  background: 'var(--bg-card)',
                  color: 'var(--text-main)',
                  padding: '6px 12px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search by ID or type..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingLeft: '32px', fontSize: '13px', width: '220px' }}
                />
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '13px', color: 'var(--text-muted)' }} />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ fontSize: '13px' }}
              >
                <option value="ALL">All Statuses</option>
                <option value="QUEUED">QUEUED</option>
                <option value="PROCESSING">PROCESSING</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </div>
          </div>

          {/* Table Content */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 20px' }}>JOB ID</th>
                  <th style={{ padding: '12px 20px' }}>TYPE</th>
                  <th style={{ padding: '12px 20px' }}>PRIORITY</th>
                  <th style={{ padding: '12px 20px' }}>STATUS</th>
                  <th style={{ padding: '12px 20px' }}>CREATED AT</th>
                  <th style={{ padding: '12px 20px', textAlign: 'center' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {loading ? 'Loading jobs from database...' : 'No jobs found. Use the form above to dispatch your first job.'}
                    </td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => (
                    <tr
                      key={job.id}
                      style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', transition: 'background 0.15s' }}
                    >
                      <td style={{ padding: '14px 20px', fontFamily: 'monospace', fontWeight: 'bold' }}>#{job.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: 500 }}>{job.type}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{
                          background: job.priority >= 8 ? 'rgba(239, 68, 68, 0.2)' : job.priority >= 5 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(100, 116, 139, 0.2)',
                          color: job.priority >= 8 ? '#f87171' : job.priority >= 5 ? '#fbbf24' : '#cbd5e1',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontWeight: 600
                        }}>
                          P{job.priority}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px' }}>{getStatusBadge(job.status)}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-muted)' }}>
                        {job.created_at ? new Date(job.created_at).toLocaleString() : 'Just now'}
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                        <button
                          onClick={() => setSelectedJob(job)}
                          style={{
                            background: 'var(--bg-card)',
                            color: 'var(--text-main)',
                            padding: '6px 10px',
                            fontSize: '12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Modal for Job Details */}
      {selectedJob && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 50
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '500px',
            padding: '24px',
            position: 'relative'
          }}>
            <button
              onClick={() => setSelectedJob(null)}
              style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', color: 'var(--text-muted)' }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Job #{selectedJob.id} Details
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Type:</span>
                <span style={{ fontWeight: 600 }}>{selectedJob.type}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Priority:</span>
                <span style={{ fontWeight: 600 }}>Level {selectedJob.priority}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Current Status:</span>
                <span>{getStatusBadge(selectedJob.status)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Created At:</span>
                <span>{new Date(selectedJob.created_at).toLocaleString()}</span>
              </div>
            </div>

            <div style={{ marginTop: '24px', textAlign: 'right' }}>
              <button
                onClick={() => setSelectedJob(null)}
                style={{ background: 'var(--bg-card)', color: 'var(--text-main)', padding: '8px 16px', fontSize: '13px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
