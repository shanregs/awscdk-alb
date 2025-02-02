import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling'
// import {CfnOutput} from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3';

export class AlbStackProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    // super(scope, id, props);
    super(scope, id, {
      env: {
        region: 'us-east-1', // Specify your desired AWS region
        account: process.env.CDK_DEFAULT_ACCOUNT
      }
    })

    const vpc = new ec2.Vpc(this, 'shanalb-vpc',{
      natGateways:1
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, 'shanalb-alb',{
      vpc,internetFacing:true
    });
    
    const listener = alb.addListener('shanalb-listener', {
      port: 80,
      open: true
    });

    const logbucket = new s3.Bucket(this, 'shanalb-albaccesslogbucket',{
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(2)
        }
      ]
    });

    alb.logAccessLogs(logbucket, 'alb-logs-prefix');

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'sudo su',
      'yum install -y httpd',
      'systemctl start httpd',
      'systemctl enable httpd',
      'echo "<h1>Hello from $(hostname -f) </h1>"  > /var/www/html/index.html'
    );

    const asg =new autoscaling.AutoScalingGroup(this, 'shanalb-asg', {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
      }),
      userData,
      minCapacity:2,
      maxCapacity:3
    });

    listener.addTargets('shan-albtargets',{
      port: 80,
      targets:[asg],
      healthCheck: {
        path: '/',
        unhealthyThresholdCount: 2,
        healthyThresholdCount: 5,
        interval: cdk.Duration.seconds(30)
      }
    });
    listener.addAction('/static', {
      priority:5,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/static'])],
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/html',
        messageBody: '<h1> Static Response from Shan ALB </h1>'
      })
    });

    
    asg.scaleOnRequestCount('request-per-minute', {
      targetRequestsPerMinute: 60
    });

    asg.scaleOnCpuUtilization('cpu-utilization',{
        targetUtilizationPercent: 75
    });

    new cdk.CfnOutput(this, 'shan-albDNS',{
      value: alb.loadBalancerDnsName
    });

    new cdk.CfnOutput(this, 'shan-alblogbucket', {
      value: logbucket.bucketName
    });
  }
}
